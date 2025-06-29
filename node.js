const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const fsPromises = fs.promises;
const csvParser = require('csv-parser');
const ini = require('ini');
const xml2js = require('xml2js');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const morgan = require('morgan');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.ini');
const LOG_PATH = path.join(__dirname, 'app.log');
const POT_PATH = path.join(__dirname, 'locales/messages.pot');
const DATA_BASEDIR = path.join(__dirname, 'data'); // Only allow data file access here

// Utility: Ensure file path is under allowed directory
function validateDataPath(requestedPath, baseDir = DATA_BASEDIR) {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') return null;
  // Only allow relative paths, no absolute paths
  const filePath = path.normalize(path.isAbsolute(requestedPath) ? requestedPath : path.join(baseDir, requestedPath));
  // Canonicalize baseDir and filePath
  const canonicalBase = path.resolve(baseDir);
  const canonicalFile = path.resolve(filePath);
  // file must be inside base dir
  if (!canonicalFile.startsWith(canonicalBase + path.sep)) return null;
  if (!fs.existsSync(canonicalFile)) return null;
  return canonicalFile;
}

// Async Config Loader
async function loadConfigAsync() {
  try {
    await fsPromises.access(CONFIG_PATH);
    const configStr = await fsPromises.readFile(CONFIG_PATH, 'utf-8');
    return ini.parse(configStr);
  } catch {
    return {};
  }
}

// Logger Stream (still using sync for server startup logging OK)
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

// Internationalization: Load .pot to JSON
function loadPotMessages(potPath) {
  if (!fs.existsSync(potPath)) return {};
  const potContent = fs.readFileSync(potPath, 'utf-8');
  const messages = {};
  const entries = potContent.split('\n\n');
  entries.forEach(entry => {
    const msgidMatch = entry.match(/msgid "([^"]*)"/);
    const msgstrMatch = entry.match(/msgstr "([^"]*)"/);
    if (msgidMatch && msgstrMatch) {
      messages[msgidMatch[1]] = msgstrMatch[1];
    }
  });
  return messages;
}

// i18next Base Configuration
const i18nResources = {
  en: { translation: loadPotMessages(POT_PATH) }
};

i18next.use(Backend).init({
  lng: 'en',
  fallbackLng: 'en',
  backend: { loadPath: path.join(__dirname, 'locales/{{lng}}.json') },
  interpolation: { escapeValue: false },
  initImmediate: false,
  resources: i18nResources
});

// Express App Setup
const app = express();
app.use(bodyParser.json());
app.use(morgan('combined', { stream: logStream }));

// Middleware: Async Config Loader per request
app.use(async (req, res, next) => {
  req.config = await loadConfigAsync();
  next();
});

// Middleware: i18n per request using cloneInstance
app.use((req, res, next) => {
  const lng = req.headers['accept-language'] || 'en';
  const localizer = i18next.cloneInstance({ lng });
  req.t = localizer.t.bind(localizer);
  req.localizer = localizer;
  next();
});

// Structured Data Endpoints
app.get('/api/data/csv', async (req, res) => {
  const csvPath = req.query.path;
  const safePath = validateDataPath(csvPath);
  if (!safePath) return res.status(400).json({ error: req.t('CSV file not found') });
  const results = [];
  try {
    fs.createReadStream(safePath)
      .pipe(csvParser())
      .on('data', (data) => results.push(data))
      .on('end', () => res.json(results))
      .on('error', () => res.status(500).json({ error: req.t('Error reading CSV') }));
  } catch {
    res.status(500).json({ error: req.t('Error reading CSV') });
  }
});

app.get('/api/data/xml', async (req, res) => {
  const xmlPath = req.query.path;
  const safePath = validateDataPath(xmlPath);
  if (!safePath) return res.status(400).json({ error: req.t('XML file not found') });
  try {
    const xml = await fsPromises.readFile(safePath, 'utf-8');
    xml2js.parseString(xml, (err, result) => {
      if (err) return res.status(500).json({ error: req.t('Error parsing XML') });
      res.json(result);
    });
  } catch {
    res.status(500).json({ error: req.t('Error reading XML') });
  }
});

app.get('/api/data/ini', async (req, res) => {
  const iniPath = req.query.path;
  const safePath = validateDataPath(iniPath);
  if (!safePath) return res.status(400).json({ error: req.t('INI file not found') });
  try {
    const content = await fsPromises.readFile(safePath, 'utf-8');
    try {
      res.json(ini.parse(content));
    } catch {
      res.status(500).json({ error: req.t('Error reading INI') });
    }
  } catch {
    res.status(500).json({ error: req.t('Error reading INI') });
  }
});

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json(req.config);
});

// Logging endpoint (async)
app.get('/api/log', async (req, res) => {
  try {
    await fsPromises.access(LOG_PATH);
    const logs = await fsPromises.readFile(LOG_PATH, 'utf-8');
    res.type('text/plain').send(logs);
  } catch {
    res.status(404).json({ error: req.t('Log file not found') });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// i18n endpoint
app.get('/api/i18n/:key', (req, res) => {
  res.json({ key: req.params.key, translation: req.t(req.params.key) });
});

// 404/error handler
app.use((req, res, next) => {
  res.status(404).json({ error: req.t('Not found') });
});
app.use((err, req, res, next) => {
  const msg = `[${new Date().toISOString()}] ERROR: ${err.stack || err}\n`;
  fsPromises.appendFile(LOG_PATH, msg).catch(() => {});
  res.status(500).json({ error: (req.t ? req.t('Internal server error') : 'Internal server error') });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] Server started on port ${PORT}\n`);
  } catch {}
});