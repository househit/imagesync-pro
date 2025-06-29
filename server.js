const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const morgan = require('morgan');
const winston = require('winston');
const ini = require('ini');
// i18next-express-middleware ensures language context is per request
const i18nextMiddleware = require('i18next-http-middleware');

let server;
let app;
let logger;
let config;

function loadConfiguration() {
  const configFile = path.join(__dirname, 'config.ini');
  if (!fs.existsSync(configFile)) {
    throw new Error(`Config file not found: ${configFile}`);
  }
  config = ini.parse(fs.readFileSync(configFile, 'utf-8'));
}

function initializeI18n() {
  const localesPath = path.join(__dirname, 'locales');
  let languages = [];
  try {
    if (!fs.existsSync(localesPath) || !fs.lstatSync(localesPath).isDirectory()) {
      throw new Error(`Locales directory not found: ${localesPath}`);
    }
    languages = fs
      .readdirSync(localesPath)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'));
    if (!languages.length) {
      throw new Error(`No valid locale files found in: ${localesPath}`);
    }
  } catch (err) {
    // Can't initialize logger yet. Use console for critical startup errors.
    console.error(err.message);
    // Provide a fallback locales config, or hard fail.
    process.exit(1);
  }
  i18next
    .use(Backend)
    .use(i18nextMiddleware.LanguageDetector)
    .init({
      fallbackLng: 'en',
      lng: config.i18n?.defaultLanguage || 'en',
      backend: {
        loadPath: path.join(localesPath, '{{lng}}.json')
      },
      preload: languages,
      initImmediate: false,
      detection: {
        order: ['header', 'querystring', 'cookie'],
        caches: false // don't set language cookie, so app is stateless per request
      }
    });
}

function setupLogging() {
  const logDir = path.join(__dirname, 'logs');
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (err) {
    // Attempt to log to console if directory creation fails
    // Since logger isn't initialized yet, write directly.
    console.error(`Failed to create log directory at ${logDir}:`, err);
    process.exit(1);
  }
  logger = winston.createLogger({
    level: config.log?.level || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({ filename: path.join(logDir, 'app.log') }),
      new winston.transports.Console()
    ]
  });
}

function setupRoutes(app) {
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  // Extend routes here as application grows
}

function handleError(err, req, res, next) {
  logger.error(`${err.message}`, { stack: err.stack, url: req.originalUrl });
  // Use req.t instead of global i18next.t
  res.status(err.status || 500).json({
    error: req.t ? req.t('internalServerError') : 'Internal server error'
  });
}

function shutdownServer() {
  if (server) {
    logger.info('Shutting down server...');
    server.close(() => {
      logger.info('Server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Force shutdown after timeout.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

function initServer() {
  loadConfiguration();
  initializeI18n();
  setupLogging();

  app = express();

  app.use(express.json());
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) }
    })
  );

  // i18next-express-middleware attaches req.t, avoids global changeLanguage
  app.use(i18nextMiddleware.handle(i18next));

  setupRoutes(app);

  app.use(handleError);

  process.on('SIGINT', shutdownServer);
  process.on('SIGTERM', shutdownServer);
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    shutdownServer();
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', reason);
    shutdownServer();
  });
}

function startServer(port) {
  server = http.createServer(app);
  server.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });
}

initServer();
startServer(config.server?.port || 3000);