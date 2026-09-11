/**
 * Minimaler `chrome`-Stub für die Testumgebung.
 *
 * Die Module unter `src/core` kommen bewusst ohne `chrome` aus — dafür sorgt eine
 * eigene ESLint-Regel. Dieser Stub existiert für Tests der Adapter-Schicht und
 * damit versehentliche Zugriffe einen aussagekräftigen Fehler statt eines
 * nichtssagenden `ReferenceError` erzeugen.
 */

/**
 * Baut einen speicherbasierten Ersatz für `chrome.storage.local`.
 * @returns {{get: Function, set: Function, remove: Function, clear: Function, _data: Map<string, unknown>}}
 */
export function createStorageAreaStub() {
  const data = new Map();

  return {
    _data: data,
    async get(keys) {
      if (keys === null || keys === undefined) return Object.fromEntries(data);
      if (typeof keys === 'string') {
        return data.has(keys) ? { [keys]: data.get(keys) } : {};
      }
      if (Array.isArray(keys)) {
        const result = {};
        for (const key of keys) if (data.has(key)) result[key] = data.get(key);
        return result;
      }
      // Objektform: Schlüssel mit Standardwerten.
      const result = {};
      for (const [key, fallback] of Object.entries(keys)) {
        result[key] = data.has(key) ? data.get(key) : fallback;
      }
      return result;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
    async clear() {
      data.clear();
    },
  };
}

/**
 * Setzt einen frischen `globalThis.chrome`-Stub.
 * @returns {object} Der erzeugte Stub.
 */
export function installChromeStub() {
  const stub = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      getManifest: () => ({ version: '5.0.0', name: 'pBlock' }),
      getURL: (path) => `chrome-extension://test-extension-id/${path}`,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      sendMessage: async () => ({ ok: true, data: null }),
    },
    storage: {
      local: createStorageAreaStub(),
      session: createStorageAreaStub(),
      onChanged: { addListener: () => {} },
    },
    declarativeNetRequest: {
      MAX_NUMBER_OF_DYNAMIC_RULES: 5000,
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
      getMatchedRules: async () => ({ rulesMatchedInfo: [] }),
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    tabs: {
      query: async () => [],
      get: async () => ({}),
      sendMessage: async () => {},
      create: async () => ({}),
    },
    alarms: { create: () => {}, clear: async () => true, onAlarm: { addListener: () => {} } },
    scripting: {
      insertCSS: async () => {},
      removeCSS: async () => {},
      executeScript: async () => [],
    },
    notifications: { create: () => {} },
    contextMenus: {
      removeAll: (cb) => cb?.(),
      create: () => {},
      onClicked: { addListener: () => {} },
    },
  };

  globalThis.chrome = stub;
  return stub;
}

installChromeStub();
