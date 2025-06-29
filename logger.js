const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { format } = require('util');
const { EventEmitter } = require('events');

let logStream = null;
let logFilePath = null;
let writeQueue = [];
let writing = false;
const LOGGER_NAME = 'logger.js';

// Configurable max length for log messages and stringified params to prevent log bloat/leaks
const MAX_MSG_LENGTH = 1000;
const MAX_PARAM_LENGTH = 2000;

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatTimestamp(d = new Date()) {
  return d.toISOString();
}

function sanitizeMessage(msg) {
  if (typeof msg !== 'string') return '';
  msg = msg.replace(/[\r\n]+/g, ' '); // Remove multiline
  if (msg.length > MAX_MSG_LENGTH) return msg.substring(0, MAX_MSG_LENGTH) + '...[truncated]';
  return msg;
}

function sanitizeParams(params) {
  // Remove potential secrets, truncate large values
  // Basic heuristic: Remove keys named password, secret, token, etc.
  function _sanitize(obj, depth = 0) {
    if (depth > 2) return '[Object depth limit]';
    if (Array.isArray(obj)) return obj.slice(0, 10).map(item => _sanitize(item, depth + 1));
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const k in obj) {
        if (typeof k === 'string' && ['password', 'secret', 'token', 'auth', 'authorization', 'cookie'].some(s => k.toLowerCase().includes(s))) {
          sanitized[k] = '[REDACTED]';
        } else {
          sanitized[k] = _sanitize(obj[k], depth + 1);
        }
      }
      return sanitized;
    }
    if (typeof obj === 'string') {
      return obj.length > 150 ? obj.substring(0, 150) + '...': obj;
    }
    return obj;
  }
  try {
    const sanitized = _sanitize(params);
    let str = JSON.stringify(sanitized);
    if (str.length > MAX_PARAM_LENGTH) str = str.substring(0, MAX_PARAM_LENGTH) + '...[truncated]';
    return JSON.parse(str);
  } catch {
    return '[Unserializable params]';
  }
}

function formatLogEntry(level, message, extra = {}) {
  const base = {
    timestamp: formatTimestamp(),
    level,
    message: sanitizeMessage(message),
    ...extra,
  };
  return JSON.stringify(base);
}

// Write queue to ensure async, ordered, race-condition-safe log writes
function enqueueWriteLogEntry(entry) {
  return new Promise((resolve, reject) => {
    if (!logStream) {
      return reject(new Error(`[${LOGGER_NAME}] Logger not initialized for writeLogEntry.`));
    }
    writeQueue.push({ entry, resolve, reject });
    processWriteQueue();
  });
}

function processWriteQueue() {
  if (writing || writeQueue.length === 0) return;
  writing = true;
  const { entry, resolve, reject } = writeQueue.shift();
  // In rare edge case, logStream could be closed between scheduling and actual write
  if (!logStream) {
    writing = false;
    reject(new Error(`[${LOGGER_NAME}] Logger not initialized during queued write.`));
    processWriteQueue();
    return;
  }
  logStream.write(entry + '\n', (err) => {
    writing = false;
    if (err) reject(err);
    else resolve();
    processWriteQueue();
  });
}

function logInfo(message) {
  return enqueueWriteLogEntry(formatLogEntry('info', message)).catch(() => { /* swallow errors to keep logging robust */ });
}

function logError(message) {
  return enqueueWriteLogEntry(formatLogEntry('error', message)).catch(() => { /* swallow errors for robustness */ });
}

function logAction(action, params) {
  const sanitized = sanitizeParams(params);
  const entry = formatLogEntry('action', `Action: ${sanitizeMessage(action)}`, { action: sanitizeMessage(action), params: sanitized });
  return enqueueWriteLogEntry(entry).catch(() => {});
}

function initLogger(logPath) {
  if (logStream) closeLogger();
  ensureDirSync(path.dirname(logPath));
  logFilePath = logPath;
  logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
}

// getLogEntries now returns a Promise resolving to entries array.
// filter is same as before.
async function getLogEntries(filter = {}) {
  if (!logFilePath) throw new Error(`[${LOGGER_NAME}] getLogEntries: Logger not initialized.`);
  // Efficient streaming for large files. Reads up to 10,000 lines max to avoid gigantic memory use.
  // If filter is provided, it applies on the fly.
  const MAX_LINES = 10000;
  let lines = [];
  try {
    const stream = fs.createReadStream(logFilePath, { encoding: 'utf8' });
    let leftover = '';
    let count = 0;

    for await (const chunk of stream) {
      let c = leftover + chunk;
      let parts = c.split('\n');
      leftover = parts.pop(); // Last, possibly partial line
      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (!filter || Object.keys(filter).length === 0 ||
              Object.entries(filter).every(([k, v]) => {
                if (typeof v === 'function') return v(entry[k]);
                if (Array.isArray(v)) return v.includes(entry[k]);
                return entry[k] === v;
              })
          ) {
            lines.push(entry);
            count++;
            if (count >= MAX_LINES) {
              stream.destroy();
              break;
            }
          }
        } catch {
          continue;
        }
      }
      if (count >= MAX_LINES) break;
    }
    // Handle last leftover if not empty
    if (leftover && lines.length < MAX_LINES) {
      try {
        const entry = JSON.parse(leftover);
        if (!filter || Object.keys(filter).length === 0 ||
            Object.entries(filter).every(([k, v]) => {
              if (typeof v === 'function') return v(entry[k]);
              if (Array.isArray(v)) return v.includes(entry[k]);
              return entry[k] === v;
            })
        ) {
          lines.push(entry);
        }
      } catch { /* ignore */ }
    }
    return lines;
  } catch (err) {
    throw new Error(`[${LOGGER_NAME}] getLogEntries failed: ${err.message}`);
  }
}

function closeLogger() {
  if (logStream) {
    logStream.end();
    logStream = null;
    logFilePath = null;
    writeQueue = [];
    writing = false;
  }
}

module.exports = {
  initLogger,
  logInfo,
  logError,
  logAction,
  getLogEntries,
  closeLogger,
};