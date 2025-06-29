const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { parse: json2csv } = require('json2csv');
const ini = require('ini');
const i18n = require('i18n');
let xmlbuilder;
try {
  xmlbuilder = require('xmlbuilder');
} catch (e) {
  xmlbuilder = null; // handled later in export
}
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const CONFIG_PATH = path.join(__dirname, 'config.ini');
const DATA_PATH = path.join(__dirname, 'data.json');
const LOG_PATH = path.join(__dirname, 'app.log');

function registerRoutes(app) {
  const router = express.Router();

  router.get('/config', handleGetConfig);
  router.post('/config', express.json(), handleUpdateConfig);

  router.get('/data', handleGetData);

  router.post('/data/import', upload.single('file'), handleImportData); // fixed: use multer

  router.get('/data/export', handleExportData);

  router.post('/locale', express.json(), handleLocaleSwitch);

  router.get('/logs', handleGetLogs);

  app.use('/api', router);
  app.use(handleError);
}

function handleGetConfig(req, res, next) {
  fs.readFile(CONFIG_PATH, 'utf-8', (err, data) => {
    if (err) return next(err);
    try {
      const config = ini.parse(data);
      res.json(config);
    } catch (parseErr) {
      next(parseErr);
    }
  });
}

function handleUpdateConfig(req, res, next) {
  const config = req.body;
  try {
    const iniStr = ini.stringify(config);
    fs.writeFile(CONFIG_PATH, iniStr, err => {
      if (err) return next(err);
      res.json({ success: true });
    });
  } catch (e) {
    next(e);
  }
}

function handleGetData(req, res, next) {
  fs.readFile(DATA_PATH, 'utf-8', (err, data) => {
    if (err) return next(err);
    try {
      res.json(JSON.parse(data));
    } catch (e) {
      next(e);
    }
  });
}

function handleImportData(req, res, next) {
  // Now using multer: check for uploaded file
  const uploadedFile = req.file;
  if (!uploadedFile || !uploadedFile.buffer) {
    return res.status(400).json({ error: 'No file uploaded (field name: "file" required)' });
  }
  const originalname = uploadedFile.originalname || '';
  const mimetype = uploadedFile.mimetype || '';
  const buffer = uploadedFile.buffer;

  // Determine file type/format by mimetype, or fallback to extension
  // Accept CSV or JSON
  let fileType;
  if (mimetype.includes('json') || originalname.match(/\.json$/i)) {
    fileType = 'json';
  } else if (mimetype.includes('csv') || originalname.match(/\.csv$/i)) {
    fileType = 'csv';
  } else {
    // fallback: try to sniff by content
    const content = buffer.slice(0, 64).toString('utf8').trim();
    if (content.startsWith('{') || content.startsWith('[')) fileType = 'json';
    else if (content.split('\n')[0].includes(',')) fileType = 'csv';
    else fileType = null;
  }

  if (fileType === 'csv') {
    const results = [];
    const readable = require('stream').Readable.from(buffer.toString());
    readable
      .pipe(csv())
      .on('data', row => results.push(row))
      .on('end', () => {
        fs.writeFile(DATA_PATH, JSON.stringify(results, null, 2), err => {
          if (err) return next(err);
          res.json({ success: true, count: results.length });
        });
      })
      .on('error', err => next(err));
  } else if (fileType === 'json') {
    try {
      const json = JSON.parse(buffer.toString());
      fs.writeFile(DATA_PATH, JSON.stringify(json, null, 2), err => {
        if (err) return next(err);
        res.json({ success: true, count: Array.isArray(json) ? json.length : 1 });
      });
    } catch (e) {
      next(e);
    }
  } else {
    res.status(400).json({ error: 'Unsupported file type. Upload .json or .csv.' });
  }
}

function handleExportData(req, res, next) {
  const format = req.query.format || 'json';
  fs.readFile(DATA_PATH, 'utf-8', (err, data) => {
    if (err) return next(err);
    try {
      const json = JSON.parse(data);
      if (format === 'csv') {
        const csvData = json2csv(json);
        res.set('Content-Type', 'text/csv');
        res.attachment('data.csv');
        res.send(csvData);
      } else if (format === 'json') {
        res.set('Content-Type', 'application/json');
        res.attachment('data.json');
        res.send(JSON.stringify(json, null, 2));
      } else if (format === 'xml') {
        if (!xmlbuilder) {
          return res.status(500).json({ error: 'XML export not available. Missing xmlbuilder module.' });
        }
        const root = xmlbuilder.create('root');
        if (Array.isArray(json)) {
          json.forEach(item => root.ele('item', item));
        } else {
          root.ele('item', json);
        }
        res.set('Content-Type', 'application/xml');
        res.attachment('data.xml');
        res.send(root.end({ pretty: true }));
      } else {
        res.status(400).json({ error: 'Unsupported format' });
      }
    } catch (e) {
      next(e);
    }
  });
}

function handleLocaleSwitch(req, res, next) {
  const locale = req.body && req.body.locale;
  if (!locale || typeof locale !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid locale' });
  }
  if (!i18n.getLocales().includes(locale)) {
    return res.status(400).json({ error: 'Unknown locale' });
  }
  res.cookie('locale', locale, { maxAge: 900000, httpOnly: true });
  i18n.setLocale(req, locale);
  res.json({ success: true, locale });
}

function handleGetLogs(req, res, next) {
  fs.readFile(LOG_PATH, 'utf-8', (err, log) => {
    if (err) return next(err);
    res.set('Content-Type', 'text/plain');
    res.send(log);
  });
}

function handleError(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  fs.appendFile(LOG_PATH, `[${new Date().toISOString()}] ERROR: ${message}\n`, () => {});
  res.status(status).json({ error: message });
}

module.exports = { registerRoutes };