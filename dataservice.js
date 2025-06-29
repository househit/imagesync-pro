const fs = require('fs');
const csv = require('csv-parser');
const { parse: json2csv } = require('json2csv');
const xml2js = require('xml2js');
const { promisify } = require('util');
const path = require('path');
const Ajv = require('ajv'); // For schema validation if schema is provided

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Atomic file write:
 *  - Writes to a temp file, then renames it atomically
 * This guards against concurrent/broken writes.
 */
async function atomicWrite(filePath, data, encoding = 'utf8') {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, data, encoding);
  await promisify(fs.rename)(tempPath, filePath);
}

// Simple write queue for serializing write operations
// Prevents concurrency issues
class WriteQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }
    this.processing = false;
  }
}

const writeQueue = new WriteQueue();

class DataService {
  async importDataFromCsv(filePath) {
    const results = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  async exportDataToCsv(data, filePath) {
    const csvData = json2csv(data);
    await atomicWrite(filePath, csvData, 'utf8');
  }

  async importDataFromXml(filePath) {
    const xml = await readFile(filePath, 'utf8');
    const parser = new xml2js.Parser({ explicitArray: false, trim: true });
    return parser.parseStringPromise(xml);
  }

  async exportDataToXml(data, filePath, rootName = 'root') {
    const builder = new xml2js.Builder({
      rootName,
      xmldec: { version: '1.0', encoding: 'UTF-8' }
    });
    const xml = builder.buildObject(data);
    await atomicWrite(filePath, xml, 'utf8');
  }

  async getData(query) {
    // Example for JSON file-based storage:
    let items;
    try {
      const raw = await readFile(DATA_FILE, 'utf8');
      items = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        items = [];
      } else {
        throw err;
      }
    }
    if (!query) return items;
    return items.filter(item =>
      Object.entries(query).every(([k, v]) => item[k] === v)
    );
  }

  async saveData(data) {
    // File-based storage with atomic write and queued (serialized) access.
    return writeQueue.add(async () => {
      let items = [];
      try {
        const raw = await readFile(DATA_FILE, 'utf8');
        items = JSON.parse(raw);
      } catch (err) {
        if (err.code === 'ENOENT') {
          items = [];
        } else {
          // Log error or rethrow - prevents silent failure on permission/corruption errors
          throw err;
        }
      }
      if (Array.isArray(data)) {
        items = data;
      } else {
        items.push(data);
      }
      await atomicWrite(DATA_FILE, JSON.stringify(items, null, 2), 'utf8');
    });
  }

  /**
   * validateData(data, schema)
   * - If a JSON Schema is provided, validates using Ajv.
   * - Otherwise only checks if it is an object or array of objects.
   *   Returns { valid: boolean, errors: array|null }
   */
  validateData(data, schema = null) {
    if (schema) {
      const ajv = new Ajv();
      const validate = ajv.compile(schema);
      const valid = validate(data);
      return { valid, errors: valid ? null : validate.errors };
    }
    // Fallback: Basic type validation
    if (Array.isArray(data)) {
      for (const el of data) {
        if (typeof el !== 'object' || el === null) {
          return { valid: false, errors: [{ message: 'Array elements must be non-null objects', data: el }] };
        }
      }
      return { valid: true, errors: null };
    }
    if (typeof data === 'object' && data !== null) {
      return { valid: true, errors: null };
    }
    return { valid: false, errors: [{ message: 'Data must be object or array of objects', data }] };
  }
}

module.exports = new DataService();