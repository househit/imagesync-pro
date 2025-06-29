const i18nResources = {
  en: { greeting: 'Hello', logout: 'Logout' },
  de: { greeting: 'Hallo', logout: 'Abmelden' },
};

function getBrowserLang() {
  const lang = navigator.language || (navigator.languages && navigator.languages[0]) || 'en';
  return lang.split('-')[0];
}

function loadLocaleData(locale) {
  return i18nResources[locale] || i18nResources.en;
}

function fetchConfig() {
  return fetch('/config.ini')
    .then((res) => res.text())
    .then((text) => {
      const lines = text.split(/\r?\n/);
      const config = {};
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) return;
        const [key, ...vals] = trimmed.split('=');
        if (key && vals.length) config[key.trim()] = vals.join('=').trim();
      });
      return config;
    })
    .catch(() => ({}));
}

async function logEvent(event, data) {
  try {
    await fetch('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, ts: Date.now() }),
    });
  } catch (e) {
    // Could emit to a local queue or perform alternative handling in a more robust implementation
    // For now, silent fail to prevent app breakage
  }
}

function fetchStructuredData() {
  return Promise.all([
    fetch('/data/data.xml').then((res) => res.text()),
    fetch('/data/data.csv').then((res) => res.text()),
  ]).then(([xmlText, csvText]) => {
    let xmlDoc = null;
    try {
      const parser = new window.DOMParser();
      xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    } catch {}
    const csvRows = csvText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(',').map((item) => item.trim()));
    return { xml: xmlDoc, csv: csvRows };
  });
}

// Simple XML serialization sanitization: removes <script> and on* attributes. For real projects use a full sanitizer!
function sanitizeXMLString(xmlString) {
  // Remove script tags (very basic)
  return xmlString
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '');
}

function MainApp() {
  const [locale, setLocale] = useState(getBrowserLang());
  const [messages, setMessages] = useState(loadLocaleData(getBrowserLang()));
  const [config, setConfig] = useState({});
  const [structured, setStructured] = useState({ xml: null, csv: [] });
  const [user, setUser] = useState({ authenticated: false, name: '' });

  useEffect(() => {
    setMessages(loadLocaleData(locale));
  }, [locale]);

  useEffect(() => {
    fetchConfig().then(setConfig);
    fetchStructuredData().then(setStructured);
  }, []);

  useEffect(() => {
    (async () => {
      await logEvent('app_mount', { locale, user: user.name });
    })();
    return () => {
      logEvent('app_unmount', {});
    };
    // eslint-disable-next-line
  }, []);

  function handleLogin(name) {
    setUser({ authenticated: true, name });
    logEvent('login', { name });
  }

  function handleLogout() {
    logEvent('logout', { name: user.name });
    setUser({ authenticated: false, name: '' });
  }

  function handleLocaleChange(e) {
    const newLocale = e.target.value;
    setLocale(newLocale);
    logEvent('change_locale', { locale: newLocale });
  }

  return (
    <Suspense fallback={null}>
      <div>
        <header>
          <select value={locale} onChange={handleLocaleChange} aria-label="Language">
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
          {user.authenticated && (
            <button onClick={handleLogout}>{messages.logout}</button>
          )}
        </header>
        <main>
          {!user.authenticated ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin(e.target.elements.username.value);
              }}
            >
              <input name="username" required placeholder="Username" />
              <button type="submit">{messages.greeting}</button>
            </form>
          ) : (
            <div>
              <h1>
                {messages.greeting}, {user.name}
              </h1>
              <section>
                <h2>Config</h2>
                <pre>{JSON.stringify(config, null, 2)}</pre>
              </section>
              <section>
                <h2>CSV Data</h2>
                <table>
                  <tbody>
                    {structured.csv.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section>
                <h2>XML Data</h2>
                <pre>
                  {structured.xml
                    ? sanitizeXMLString(
                        new XMLSerializer().serializeToString(structured.xml)
                      )
                    : ''}
                </pre>
              </section>
            </div>
          )}
        </main>
      </div>
    </Suspense>
  );
}

export default MainApp;