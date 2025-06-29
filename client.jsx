const locales = ['en', 'es', 'fr', 'de'];
const i18nTexts = {
  en: {
    import: 'Import',
    export: 'Export',
    config: 'Configuration',
    selectFile: 'Select File',
    selectType: 'Select Type',
    changeLocale: 'Change Language',
    submit: 'Submit',
    dataImported: 'Data imported successfully.',
    dataExported: 'Data exported.',
    fetchError: 'Failed to communicate with server.',
    choose: 'Choose',
  },
  es: {
    import: 'Importar',
    export: 'Exportar',
    config: 'Configuraci?n',
    selectFile: 'Seleccionar Archivo',
    selectType: 'Seleccionar Tipo',
    changeLocale: 'Cambiar Idioma',
    submit: 'Enviar',
    dataImported: 'Datos importados exitosamente.',
    dataExported: 'Datos exportados.',
    fetchError: 'Fallo en la comunicaci?n con el servidor.',
    choose: 'Elegir',
  },
  fr: {
    import: 'Importer',
    export: 'Exporter',
    config: 'Configuration',
    selectFile: 'S?lectionner le fichier',
    selectType: 'S?lectionner le type',
    changeLocale: 'Changer la langue',
    submit: 'Soumettre',
    dataImported: 'Donn?es import?es avec succ?s.',
    dataExported: 'Donn?es export?es.',
    fetchError: '?chec de la communication avec le serveur.',
    choose: 'Choisir',
  },
  de: {
    import: 'Importieren',
    export: 'Exportieren',
    config: 'Konfiguration',
    selectFile: 'Datei ausw?hlen',
    selectType: 'Typ ausw?hlen',
    changeLocale: 'Sprache ?ndern',
    submit: 'Senden',
    dataImported: 'Daten erfolgreich importiert.',
    dataExported: 'Daten exportiert.',
    fetchError: 'Kommunikation mit dem Server fehlgeschlagen.',
    choose: 'Ausw?hlen',
  },
};

const configTypes = ['xml', 'csv', 'ini'];
const dataTypes = ['xml', 'csv'];

// Only set 'headers' if not sending FormData
async function fetchApi(endpoint, options = {}) {
  try {
    const hasFormData =
      options.body && typeof window !== 'undefined' && options.body instanceof FormData;
    const fetchOptions = {
      credentials: 'same-origin',
      ...options,
    };
    // Don't set headers if sending FormData, to allow browser to set Content-Type and boundaries
    if (!hasFormData && options.headers) {
      fetchOptions.headers = options.headers;
    }
    const res = await fetch(endpoint, fetchOptions);
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await res.json();
    }
    return await res.text();
  } catch (err) {
    throw err;
  }
}

function App() {
  const [locale, setLocale] = useState('en');
  const [config, setConfig] = useState(null);
  const [message, setMessage] = useState('');
  const [importType, setImportType] = useState(dataTypes[0]);
  const [exportType, setExportType] = useState(dataTypes[0]);
  const [importFile, setImportFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const t = useCallback(
    (key) => (i18nTexts[locale] && i18nTexts[locale][key]) || key,
    [locale]
  );

  const displayConfig = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await fetchApi('/api/config');
      setConfig(cfg);
    } catch (err) {
      setMessage(t('fetchError'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line
  }, [t]);

  useEffect(() => {
    displayConfig();
  }, [displayConfig]);

  function changeLocale(nextLocale) {
    setLocale(nextLocale);
    setMessage('');
  }

  async function importData(type, file) {
    setLoading(true);
    setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetchApi(`/api/import/${type}`, {
        method: 'POST',
        body: form,
      });
      setMessage(t('dataImported'));
      handleUserAction({ type: 'import', res, typeImport: type });
      displayConfig();
    } catch (err) {
      setMessage(t('fetchError'));
    } finally {
      setLoading(false);
    }
  }

  async function exportData(type) {
    setLoading(true);
    setMessage('');
    try {
      const result = await fetchApi(`/api/export/${type}`, { method: 'GET' });
      const filename = `export.${type}`;
      const blob = new Blob([result], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(t('dataExported'));
      handleUserAction({ type: 'export', result, typeExport: type });
    } catch (err) {
      setMessage(t('fetchError'));
    } finally {
      setLoading(false);
    }
  }

  function handleUserAction(action) {
    window.console.log('UserAction', action);
  }

  function handleImportFileChange(e) {
    setImportFile(e.target.files[0]);
  }

  function handleImportSubmit(e) {
    e.preventDefault();
    if (importFile && importType) {
      importData(importType, importFile);
    }
  }

  function handleExportSubmit(e) {
    e.preventDefault();
    if (exportType) {
      exportData(exportType);
    }
  }

  return (
    <div style={{ maxWidth: 540, margin: '24px auto', fontFamily: 'sans-serif' }}>
      <h1>{t('config')}</h1>
      <label>
        {t('changeLocale') + ':'}{' '}
        <select
          value={locale}
          onChange={(e) => changeLocale(e.target.value)}
        >
          {locales.map((loc) => (
            <option key={loc} value={loc}>
              {loc.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <hr />
      <form onSubmit={handleImportSubmit}>
        <fieldset style={{ marginBottom: 16 }}>
          <legend>{t('import')}</legend>
          <label>
            {t('selectType') + ':'}{' '}
            <select
              value={importType}
              onChange={(e) => setImportType(e.target.value)}
            >
              {dataTypes.map((type) => (
                <option key={type} value={type}>
                  {type.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <br />
          <label>
            {t('selectFile') + ':'}{' '}
            <input
              type="file"
              accept={dataTypes.map((t) => '.' + t).join(',')}
              onChange={handleImportFileChange}
            />
          </label>
          <br />
          <button type="submit" disabled={loading || !importFile}>
            {t('submit')}
          </button>
        </fieldset>
      </form>
      <form onSubmit={handleExportSubmit}>
        <fieldset style={{ marginBottom: 16 }}>
          <legend>{t('export')}</legend>
          <label>
            {t('selectType') + ':'}{' '}
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value)}
            >
              {dataTypes.map((type) => (
                <option key={type} value={type}>
                  {type.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <br />
          <button type="submit" disabled={loading}>
            {t('submit')}
          </button>
        </fieldset>
      </form>
      <section>
        <fieldset>
          <legend>{t('config')}</legend>
          {loading ? (
            <div>...</div>
          ) : config ? (
            <pre style={{ background: '#f6f6fa', padding: 12 }}>
              {typeof config === 'object'
                ? JSON.stringify(config, null, 2)
                : config}
            </pre>
          ) : (
            <span>-</span>
          )}
        </fieldset>
      </section>
      <div style={{ margin: '16px 0', color: '#067', minHeight: 20 }}>
        {message}
      </div>
    </div>
  );
}

export default App;