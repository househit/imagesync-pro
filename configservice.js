const fs = require('fs');
const path = require('path');
const ini = require('ini');
const EventEmitter = require('events');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const csvParse = require('csv-parse/sync');
const csvStringify = require('csv-stringify/sync');

class ConfigService extends EventEmitter {
    constructor() {
        super();
        this._config = {};
        this._watchedFiles = new Map();
        this._watchDebounces = new Map();
        this._configPath = null;
    }

    _detectFormat(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.json') return 'json';
        if (ext === '.ini') return 'ini';
        if (ext === '.xml') return 'xml';
        if (ext === '.csv') return 'csv';
        throw new Error(`Unsupported config file extension: ${ext}`);
    }

    async loadConfig(configPath) {
        const absPath = path.resolve(configPath);
        if (!fs.existsSync(absPath)) throw new Error('Config file does not exist');
        const format = this._detectFormat(absPath);
        const raw = await fs.promises.readFile(absPath, 'utf8');
        switch (format) {
            case 'json':
                this._config = JSON.parse(raw);
                break;
            case 'ini':
                this._config = ini.parse(raw);
                break;
            case 'xml': {
                const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
                this._config = parser.parse(raw);
                break;
            }
            case 'csv': {
                const records = csvParse.parse(raw, { columns: true });
                if (records.length && Object.keys(records[0]).length === 2) {
                    const keys = Object.keys(records[0]);
                    this._config = {};
                    records.forEach(row => {
                        this._config[row[keys[0]]] = row[keys[1]];
                    });
                } else {
                    this._config = { records };
                }
                break;
            }
        }
        this._configPath = absPath;
    }

    // Handles dot-notated paths with array indices, e.g., some.arr.0.key
    static _parsePath(key) {
        if (!key) return [];
        // Convert 'arr.0.key' or 'foo[1].bar' to ['arr', 0, 'key'] etc.
        // Supports both dot and bracket notation
        // e.g. 'a.b[0].c' -> ['a', 'b', 0, 'c']
        const re = /([^[.\]]+)|\[(\d+)\]/g;
        const matches = [];
        let m;
        while ((m = re.exec(key))) {
            if (m[1] !== undefined) matches.push(m[1]);
            else if (m[2] !== undefined) matches.push(Number(m[2]));
        }
        return matches;
    }

    getConfig(key) {
        if (!key) return this._config;
        const keys = ConfigService._parsePath(key);
        return keys.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), this._config);
    }

    setConfig(key, value) {
        const keys = ConfigService._parsePath(key);
        if (keys.length === 0) return;
        let obj = this._config;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            const nextK = keys[i + 1];
            if (typeof nextK === 'number') {
                if (!Array.isArray(obj[k])) obj[k] = [];
            } else {
                if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {};
            }
            obj = obj[k];
        }
        obj[keys[keys.length - 1]] = value;
    }

    async saveConfig(savePath = null) {
        const filePath = savePath ? path.resolve(savePath) : this._configPath;
        if (!filePath) throw new Error('No config file path specified');
        const format = this._detectFormat(filePath);
        let out;
        switch (format) {
            case 'json':
                out = JSON.stringify(this._config, null, 2);
                break;
            case 'ini':
                out = ini.stringify(this._config);
                break;
            case 'xml': {
                const builder = new XMLBuilder({ ignoreAttributes: false, processEntities: true, format: true });
                out = builder.build(this._config);
                break;
            }
            case 'csv': {
                let records;
                if (
                    Object.values(this._config).every(
                        v => typeof v !== 'object' || Array.isArray(v)
                    )
                ) {
                    records = Object.entries(this._config).map(([k, v]) => ({ key: k, value: v }));
                } else if (Array.isArray(this._config.records)) {
                    records = this._config.records;
                } else {
                    throw new Error('Unsupported structure for csv export');
                }
                out = csvStringify.stringify(records, { header: true });
                break;
            }
        }
        await fs.promises.writeFile(filePath, out, 'utf8');
    }

    watchConfig(configPath, callback) {
        const absPath = path.resolve(configPath);
        if (this._watchedFiles.has(absPath)) return;
        let debounceTimeout = null;
        const DEBOUNCE_MS = 150;
        const handler = async (eventType) => {
            if (eventType === 'change' || eventType === 'rename') {
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(async () => {
                    try {
                        await this.loadConfig(absPath);
                        callback(this._config);
                        this.emit('configChanged', this._config);
                    } catch (e) {
                        // Surface/log the error for debugging
                        console.error(`Error reloading config (${absPath}):`, e);
                        this.emit('configReloadError', e);
                    }
                }, DEBOUNCE_MS);
            }
        };
        const watcher = fs.watch(absPath, handler);
        this._watchedFiles.set(absPath, watcher);
        this._watchDebounces.set(absPath, () => clearTimeout(debounceTimeout));
    }

    unwatchConfig(configPath) {
        const absPath = path.resolve(configPath);
        const watcher = this._watchedFiles.get(absPath);
        if (watcher) {
            watcher.close();
            this._watchedFiles.delete(absPath);
        }
        const clearDebounce = this._watchDebounces.get(absPath);
        if (clearDebounce) {
            clearDebounce();
            this._watchDebounces.delete(absPath);
        }
    }
}

module.exports = new ConfigService();