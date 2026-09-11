/**
 * Metadaten der zuschaltbaren Filterlisten.
 *
 * Die Listen werden zur Laufzeit heruntergeladen und lokal in
 * declarativeNetRequest-Regeln übersetzt. Wichtig für die Chrome-Web-Store-Prüfung:
 * Hier wird **kein Code** nachgeladen, sondern ausschließlich Daten. Der Parser
 * liegt vollständig im Paket (siehe `filter-parser.js`).
 */

/**
 * @typedef {object} PresetDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} url Quelle der Liste.
 * @property {string} license
 * @property {string} homepage
 * @property {number} approximateRules Grobe Größenordnung für die Oberfläche.
 * @property {boolean} recommended
 */

/** @type {Readonly<Record<string, PresetDefinition>>} */
export const PRESETS = Object.freeze({
  easylist: {
    id: 'easylist',
    name: 'EasyList',
    description: 'Die Standardliste gegen Werbung. Breite Abdeckung, international gepflegt.',
    url: 'https://easylist.to/easylist/easylist.txt',
    license: 'GPLv3 / CC BY-SA 3.0',
    homepage: 'https://easylist.to/',
    approximateRules: 70_000,
    recommended: true,
  },
  easyprivacy: {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    description: 'Ergänzt EasyList um Tracking- und Analyse-Dienste.',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    license: 'GPLv3 / CC BY-SA 3.0',
    homepage: 'https://easylist.to/',
    approximateRules: 30_000,
    recommended: true,
  },
  easylist_germany: {
    id: 'easylist_germany',
    name: 'EasyList Germany',
    description: 'Ergänzung für deutschsprachige Seiten.',
    url: 'https://easylist.to/easylistgermany/easylistgermany.txt',
    license: 'GPLv3 / CC BY-SA 3.0',
    homepage: 'https://easylist.to/',
    approximateRules: 8_000,
    recommended: true,
  },
  peter_lowe: {
    id: 'peter_lowe',
    name: "Peter Lowe's List",
    description: 'Kompakte, sehr treffsichere Liste von Werbe- und Tracking-Servern.',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
    license: 'Frei für private Nutzung',
    homepage: 'https://pgl.yoyo.org/adservers/',
    approximateRules: 3_000,
    recommended: false,
  },
  urlhaus: {
    id: 'urlhaus',
    name: 'URLhaus Malware',
    description: 'Blockiert Domains, die aktiv Schadsoftware ausliefern.',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
    license: 'CC0',
    homepage: 'https://gitlab.com/malware-filter/urlhaus-filter',
    approximateRules: 5_000,
    recommended: true,
  },
});

/** Wie lange eine heruntergeladene Liste als aktuell gilt. */
export const PRESET_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} PresetMeta
 * @property {boolean} enabled
 * @property {number} ruleCount Wie viele Regeln nach dem Parsen übrig blieben.
 * @property {number} sourceEntries Wie viele Einträge die Quelle hatte.
 * @property {number|null} updatedAt Epoch-Millisekunden des letzten Downloads.
 * @property {string|null} lastError Fehlermeldung des letzten Versuchs.
 */

/**
 * Leerer Metadatensatz.
 * @returns {PresetMeta}
 */
export function createEmptyPresetMeta() {
  return { enabled: false, ruleCount: 0, sourceEntries: 0, updatedAt: null, lastError: null };
}

/**
 * Repariert die gespeicherten Metadaten und wirft unbekannte Listen weg.
 * @param {unknown} stored
 * @returns {Record<string, PresetMeta>}
 */
export function normalizePresetMeta(stored) {
  /** @type {Record<string, PresetMeta>} */
  const result = {};
  for (const id of Object.keys(PRESETS)) result[id] = createEmptyPresetMeta();

  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return result;

  for (const [id, meta] of Object.entries(stored)) {
    if (!result[id] || typeof meta !== 'object' || meta === null) continue;
    if (typeof meta.enabled === 'boolean') result[id].enabled = meta.enabled;
    if (Number.isFinite(meta.ruleCount) && meta.ruleCount >= 0) {
      result[id].ruleCount = Math.floor(meta.ruleCount);
    }
    if (Number.isFinite(meta.sourceEntries) && meta.sourceEntries >= 0) {
      result[id].sourceEntries = Math.floor(meta.sourceEntries);
    }
    if (Number.isFinite(meta.updatedAt)) result[id].updatedAt = meta.updatedAt;
    if (typeof meta.lastError === 'string' && meta.lastError.length > 0) {
      result[id].lastError = meta.lastError.slice(0, 300);
    }
  }

  return result;
}

/**
 * Listen, die aktiv sind und deren Daten zu alt sind.
 * @param {Record<string, PresetMeta>} meta
 * @param {number} [now=Date.now()]
 * @returns {string[]}
 */
export function getStalePresetIds(meta, now = Date.now()) {
  return Object.entries(meta)
    .filter(([, entry]) => entry.enabled)
    .filter(([, entry]) => entry.updatedAt === null || now - entry.updatedAt > PRESET_MAX_AGE_MS)
    .map(([id]) => id);
}

/**
 * Stellt Definition und Zustand für die Oberfläche zusammen.
 * @param {Record<string, PresetMeta>} meta
 * @param {number} [now=Date.now()]
 * @returns {Array<PresetDefinition & PresetMeta & {isStale: boolean}>}
 */
export function describePresets(meta, now = Date.now()) {
  return Object.values(PRESETS).map((definition) => {
    const entry = meta[definition.id] ?? createEmptyPresetMeta();
    return {
      ...definition,
      ...entry,
      isStale:
        entry.enabled && (entry.updatedAt === null || now - entry.updatedAt > PRESET_MAX_AGE_MS),
    };
  });
}

/**
 * Prüft, ob eine URL als Filterlistenquelle zulässig ist.
 *
 * Nur HTTPS, keine IP-Literale, keine Zugangsdaten in der URL. Das verhindert,
 * dass ein manipulierter Import die Erweiterung dazu bringt, Inhalte von einem
 * beliebigen Server zu laden.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedPresetUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) return false;
  return true;
}
