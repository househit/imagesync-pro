const fs = require('fs');
const path = require('path');

/**
 * i18n.js
 * Production-grade PO/POT file loader and runtime translation manager.
 * Supports context, plural forms, multi-line entries, and translation fallback.
 */

class I18n {
  constructor() {
    this.translations = {}; // { locale: { key: value | {plural, ...} } }
    this.locales = new Set();
    this.currentLocale = 'en';
    this.defaultLocale = 'en'; // Can be made configurable
  }

  /**
   * Initialize the i18n service.
   * @param {string} locale
   * @param {object} [options] - { defaultLocale }
   */
  initI18n(locale, options = {}) {
    if (options.defaultLocale) {
      this.defaultLocale = options.defaultLocale;
    }
    if (locale) {
      this.setLocale(locale);
    }
  }

  /**
   * Set the currently active locale.
   * @param {string} locale
   */
  setLocale(locale) {
    if (this.translations[locale]) {
      this.currentLocale = locale;
    } else {
      throw new Error(`Locale ${locale} not loaded`);
    }
  }

  /**
   * Get the active locale.
   * @returns {string}
   */
  getLocale() {
    return this.currentLocale;
  }

  /**
   * Translate a key for current locale, with runtime substitution.
   * Fallbacks to defaultLocale if not present.
   * Handles context (`key|ctx`) and simple plural via n param.
   * @param {string} key
   * @param {object} [params] - params for interpolation; use 'n' for plural forms
   */
  translate(key, params = {}) {
    const locale = this.currentLocale;
    let t = this._lookupTranslation(locale, key, params);
    if (t == null && locale !== this.defaultLocale) {
      t = this._lookupTranslation(this.defaultLocale, key, params);
    }
    if (t == null) t = key;
    if (!params || typeof t !== "string") return t;
    return t.replace(/\{(.*?)\}/g, (_, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? params[k] : `{${k}}`
    );
  }

  _lookupTranslation(locale, key, params) {
    const lang = this.translations[locale] || {};
    // Context support: key may be "real_key|ctx"
    let searchKey = key;
    if (params.ctx) {
      searchKey = `${key}|${params.ctx}`;
    }
    let entry = lang[searchKey];
    if (entry != null && typeof entry === 'object' && entry.plural) {
      // Plural entry; params must provide n
      const n = typeof params.n === 'number' ? params.n : 1;
      const idx = this._getPluralIndex(locale, n);
      entry = entry.plural[idx] != null ? entry.plural[idx] : entry.plural[0];
    }
    return entry != null ? entry : lang[key];
  }

  /**
   * Loads a .pot file (template). Optionally specify base locale.
   * @param {string} potFilePath
   * @param {object} [options] - { locale }
   */
  loadPotFile(potFilePath, options = {}) {
    const content = fs.readFileSync(potFilePath, 'utf8');
    const entries = parsePoPot(content);
    // Allow configuring locale for .pot files; default to 'en'
    const locale = options.locale || this.defaultLocale;
    if (!this.translations[locale]) this.translations[locale] = {};
    for (const [k, v] of Object.entries(entries)) {
      this.translations[locale][k] = v;
    }
    this.locales.add(locale);
  }

  /**
   * Loads a .po file for a locale.
   * @param {string} locale
   * @param {string} poFilePath
   */
  loadPoFile(locale, poFilePath) {
    const content = fs.readFileSync(poFilePath, 'utf8');
    const entries = parsePoPot(content);
    if (!this.translations[locale]) this.translations[locale] = {};
    for (const [k, v] of Object.entries(entries)) {
      this.translations[locale][k] = v;
    }
    this.locales.add(locale);
  }

  /**
   * Lists available loaded locales.
   * @returns {string[]}
   */
  getAvailableLocales() {
    return Array.from(this.locales);
  }

  /**
   * Extract plural form logic for a given locale from translation MO/metadata.
   * Fallback to English rules (n != 1 ? 1 : 0).
   * For production, consider using the 'make-plural' library or CLDR data.
   * @param {string} locale
   * @param {number} n
   * @returns {number}
   */
  _getPluralIndex(locale, n) {
    // Naive rules for several common langs
    const lc = locale.toLowerCase();
    if (lc.startsWith('ja') || lc.startsWith('zh') || lc.startsWith('ko')) {
      return 0; // No plural
    }
    if (lc.startsWith('fr')) return n > 1 ? 1 : 0;
    // fallback (en, de, ru, pl etc)
    return n !== 1 ? 1 : 0;
  }
}

/**
 * Fully-featured parser for .po/.pot files.
 * Supports msgid, msgid_plural, msgstr[n], msgctxt, multiline, and interpolation.
 * Returns: { [key | key|ctx]: value (string) | { plural: [str0, str1...] } }
 */
function parsePoPot(str) {
  const lines = str.split(/\r?\n/);

  let header = {};
  let entries = {};
  let curr = null; // {msgid,msgid_plural,msgstr,msgstr_plural,msgctxt,comments}
  let lastField = null;

  function flushEntry() {
    if (!curr || curr.skip) return;
    let key = curr.msgid;
    if (curr.msgctxt) key += '|' + curr.msgctxt;
    if (!key) return;
    if (curr.msgid_plural !== null && curr.msgstr_plural.length) {
      entries[key] = {
        plural: curr.msgstr_plural.slice(),
      };
    } else {
      entries[key] = curr.msgstr;
    }
  }

  /**
   * Strip quotes and escapes.
   * @param {string} s
   * @returns {string}
   */
  function cleanPoString(s) {
    if (!s) return '';
    s = s.trim();
    if (s[0] === '"' && s[s.length - 1] === '"') {
      s = s.slice(1, -1);
    }
    return s
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }

  // parser state
  curr = {
    msgid: null,
    msgid_plural: null,
    msgctxt: null,
    msgstr: '',
    msgstr_plural: [],
    comments: '',
    skip: false,
  };
  lastField = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let trimmed = line.trim();

    if (!trimmed) {
      // end of entry block
      flushEntry();
      curr = {
        msgid: null,
        msgid_plural: null,
        msgctxt: null,
        msgstr: '',
        msgstr_plural: [],
        comments: '',
        skip: false,
      };
      lastField = null;
      continue;
    }
    // Comments
    if (trimmed.startsWith('#')) {
      curr.comments += trimmed + '\n';
      continue;
    }
    // Msgctxt
    if (trimmed.startsWith('msgctxt')) {
      curr.msgctxt = cleanPoString(trimmed.slice(7).trim());
      lastField = 'msgctxt';
      continue;
    }
    // Msgid
    if (trimmed.startsWith('msgid_plural')) {
      curr.msgid_plural = cleanPoString(trimmed.slice(12).trim());
      lastField = 'msgid_plural';
      continue;
    }
    if (trimmed.startsWith('msgid')) {
      curr.msgid = cleanPoString(trimmed.slice(5).trim());
      lastField = 'msgid';
      continue;
    }
    // Msgstr (singular)
    if (trimmed.startsWith('msgstr ')) {
      curr.msgstr = cleanPoString(trimmed.slice(6).trim());
      lastField = 'msgstr';
      continue;
    }
    // Msgstr[n]
    const msgstr_plural_match = trimmed.match(/^msgstr\[(\d+)]\s*(.*)/);
    if (msgstr_plural_match) {
      const idx = parseInt(msgstr_plural_match[1], 10);
      curr.msgstr_plural[idx] = cleanPoString(msgstr_plural_match[2]);
      lastField = `msgstr_plural_${idx}`;
      continue;
    }
    // Multiline append
    if (trimmed.startsWith('"')) {
      const value = cleanPoString(trimmed);
      // Which field are we continuing?
      if (lastField === 'msgid') {
        curr.msgid += value;
      } else if (lastField === 'msgid_plural') {
        curr.msgid_plural += value;
      } else if (lastField === 'msgctxt') {
        curr.msgctxt += value;
      } else if (lastField === 'msgstr') {
        curr.msgstr += value;
      } else if (lastField && lastField.startsWith('msgstr_plural_')) {
        const idx = parseInt(lastField.split('_')[2], 10);
        curr.msgstr_plural[idx] = (curr.msgstr_plural[idx] || '') + value;
      }
      continue;
    }
    // Invalid/unknown lines ignored
  }
  // Flush any last entry
  flushEntry();

  // Remove empty header if present
  if (entries['']) {
    // Optionally, extract plural-forms, language, etc.
    // header = parsePOHeader(entries['']);
    delete entries[''];
  }

  return entries;
}

module.exports = new I18n();