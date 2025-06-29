const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const cors = require('cors');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const ini = require('ini');

// Utility logger for async error catching
function safeLogError(logPath, err) {
  fsp.appendFile(logPath, `${new Date().toISOString()} ${String(err.stack || err)}\n`).catch(() => {});
}

// Safe configuration/file loader
async function loadConfig(configPath, defaults = {}) {
  try {
    const data = await fsp.readFile(configPath, 'utf-8');
    return ini.parse(data);
  } catch (err) {
    // Fallback to defaults, but still log
    safeLogError(path.join(__dirname, 'logs', 'error.log'), err);
    return defaults;
  }
}

// Safe directory creator
async function ensureDir(dirPath) {
  try {
    await fsp.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Safe locale loader (returns ['en', ...] or safe fallback)
function getLocales(localesPath, fallback = ['en']) {
  try {
    return fs.readdirSync(localesPath)
      .map(f => path.parse(f).name)
      .filter(Boolean);
  } catch (err) {
    safeLogError(path.join(__dirname, 'logs', 'error.log'), err);
    return fallback;
  }
}

// Main async startup routine
(async () => {
  // Paths
  const configPath = path.join(__dirname, 'config', 'app.ini');
  const logDirectory = path.join(__dirname, 'logs');
  const localesDir = path.join(__dirname, 'locales');

  // Ensure logs directory exists
  await ensureDir(logDirectory);

  // Load config (with safe fallback)
  const configDefaults = {
    server: { port: 3000 },
    i18n: { defaultLng: 'en', fallbackLng: 'en' },
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
  };
  const config = await loadConfig(configPath, configDefaults);

  // Setup log stream for access logs (auto-create if missing)
  const accessLogPath = path.join(logDirectory, 'access.log');
  let accessLogStream;
  try {
    accessLogStream = fs.createWriteStream(accessLogPath, { flags: 'a' });
  } catch (err) {
    // fallback to process.stdout
    accessLogStream = process.stdout;
    safeLogError(path.join(logDirectory, 'error.log'), err);
  }

  // Determine available/preload locales
  const preloadLocales = getLocales(localesDir, [config.i18n?.defaultLng || 'en']);

  // Initialize i18n (fail gracefully)
  await new Promise(resolve => {
    i18next
      .use(Backend)
      .init({
        lng: config.i18n?.defaultLng || 'en',
        fallbackLng: config.i18n?.fallbackLng || 'en',
        backend: {
          loadPath: path.join(localesDir, '{{lng}}.json')
        },
        preload: preloadLocales
      }, (err) => {
        if (err) safeLogError(path.join(logDirectory, 'error.log'), err);
        resolve();
      });
  });

  const app = express();

  // Logging middleware (access)
  app.use(morgan('combined', { stream: accessLogStream }));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(cookieParser());

  // CORS (can be turned off or customized via config)
  app.use(cors({
    origin: config.cors?.origin || '*',
    methods: config.cors?.methods || ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }));

  // i18n middleware (makes req.t available in all handlers)
  app.use((req, res, next) => {
    const lang =
      req.headers['accept-language']?.split(',')[0] ||
      config.i18n?.defaultLng ||
      'en';
    req.t = i18next.getFixedT(lang);
    next();
  });

  // --- API routes ---
  const apiRouter = express.Router();

  // Example API endpoint
  apiRouter.get('/status', (req, res) => {
    res.json({ status: 'ok', message: req.t('status.ok', { defaultValue: 'OK' }) });
  });

  // 404 route for undefined API endpoints
  apiRouter.use((req, res, next) => {
    res.status(404).json({ error: req.t('error.notfound', { defaultValue: 'API endpoint not found' }) });
  });

  app.use('/api', apiRouter);

  // --- Static frontend ---
  const buildPath = path.join(__dirname, 'frontend', 'build');
  // Serve static assets
  app.use(express.static(buildPath));
  // Wildcard route only for requests not starting with /api or existing static
  app.get(/^\/(?!api\/).*/, async (req, res, next) => {
    try {
      // Only serve index.html if it exists
      const indexFile = path.join(buildPath, 'index.html');
      await fsp.access(indexFile, fs.constants.R_OK);
      res.sendFile(indexFile);
    } catch (err) {
      next();
    }
  });

  // --- Error handling ---

  // 404 for all other unmatched URLs (after frontend, after API 404)
  app.use((req, res, next) => {
    if (!res.headersSent) {
      res.status(404).json({ error: req.t('error.notfound', { defaultValue: 'Not found' }) });
    }
  });

  // Error handler
  app.use((err, req, res, next) => {
    const errorLogPath = path.join(logDirectory, 'error.log');
    // Status assignment: try to pick err.status or err.statusCode, fallback to 500
    const status = err.status || err.statusCode || 500;
    safeLogError(errorLogPath, err);
    if (res.headersSent) return next(err);
    const isValidationError = status === 400;
    if (status === 404) {
      res.status(404).json({ error: req.t('error.notfound', { defaultValue: 'Not found' }) });
    } else if (isValidationError) {
      res.status(400).json({ error: req.t('error.badrequest', { defaultValue: 'Invalid request' }) });
    } else {
      res.status(status).json({ error: req.t('error.internal', { defaultValue: 'Internal server error' }) });
    }
  });

  // --- Startup ---
  const port = Number(config.server?.port) || 3000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
})();