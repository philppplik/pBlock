/**
 * Metadaten der zuschaltbaren Filterlisten.
 *
 * Die Listen werden zur Laufzeit heruntergeladen und lokal in
 * declarativeNetRequest-Regeln übersetzt. Wichtig für die Chrome-Web-Store-Prüfung:
 * Hier wird **kein Code** nachgeladen, sondern ausschließlich Daten. Der Parser
 * liegt vollständig im Paket (siehe `filter-parser.js`).
 *
 * ## Mehrere Quellen je Liste
 *
 * Jede Liste nennt mehrere Adressen, die der Reihe nach versucht werden. Die
 * Idee stammt von uBlock Origin, das in seiner `assets.json` pro Liste mehrere
 * `contentURL`-Einträge führt und bei Bedarf auf einen Spiegel ausweicht.
 *
 * Der Nutzen ist konkret: Ist `easylist.to` nicht erreichbar — was regelmäßig
 * vorkommt — wird die Liste über die CDN-Spiegel von uBlock Origin oder über
 * Adblock Plus geholt. Der Nutzer merkt von dem Ausfall nichts.
 *
 * Übernommen ist hier die *Idee* und die Kenntnis der öffentlichen Adressen,
 * kein Code: uBlock Origin steht unter GPLv3, pBlock unter MIT. Siehe CREDITS.md.
 */

/**
 * @typedef {object} PresetDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} urls Quellen in der Reihenfolge, in der sie versucht werden.
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
    urls: [
      'https://easylist.to/easylist/easylist.txt',
      'https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist.txt',
      'https://easylist-downloads.adblockplus.org/easylist.txt',
    ],
    license: 'GPLv3 / CC BY-SA 3.0',
    homepage: 'https://easylist.to/',
    approximateRules: 70_000,
    recommended: true,
  },
  easyprivacy: {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    description: 'Ergänzt EasyList um Tracking- und Analyse-Dienste.',
    urls: [
      'https://easylist.to/easylist/easyprivacy.txt',
      'https://ublockorigin.github.io/uAssetsCDN/thirdparties/easyprivacy.txt',
      'https://easylist-downloads.adblockplus.org/easyprivacy.txt',
    ],
    license: 'GPLv3 / CC BY-SA 3.0',
    homepage: 'https://easylist.to/',
    approximateRules: 30_000,
    recommended: true,
  },
  easylist_germany: {
    id: 'easylist_germany',
    name: 'EasyList Germany',
    description: 'Ergänzung für deutschsprachige Seiten.',
    urls: [
      'https://easylist.to/easylistgermany/easylistgermany.txt',
      'https://easylist-downloads.adblockplus.org/easylistgermany.txt',
    ],
    license: 'GPLv3 / CC BY-SA 3.0',
    homepage: 'https://easylist.to/',
    approximateRules: 8_000,
    recommended: true,
  },
  peter_lowe: {
    id: 'peter_lowe',
    name: "Peter Lowe's List",
    description: 'Kompakte, sehr treffsichere Liste von Werbe- und Tracking-Servern.',
    // Beide Adressen liegen auf demselben Server — einen unabhängigen Spiegel
    // gibt es für diese Liste nicht. Der zweite Eintrag hilft nur gegen Fehler
    // in der Inhaltsaushandlung, nicht gegen einen Serverausfall.
    urls: [
      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
    ],
    license: 'Frei für private Nutzung',
    homepage: 'https://pgl.yoyo.org/adservers/',
    approximateRules: 3_000,
    recommended: false,
  },
  urlhaus: {
    id: 'urlhaus',
    name: 'URLhaus Malware',
    description: 'Blockiert Domains, die aktiv Schadsoftware ausliefern.',
    urls: [
      'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
      'https://malware-filter.pages.dev/urlhaus-filter-online.txt',
      'https://curbengh.github.io/malware-filter/urlhaus-filter-online.txt',
    ],
    license: 'CC0',
    homepage: 'https://gitlab.com/malware-filter/urlhaus-filter',
    approximateRules: 9_000,
    recommended: true,
  },
});

/**
 * Alle Adressen, über die Filterlisten bezogen werden.
 *
 * Diese Adressen müssen **immer** erreichbar bleiben. Sie dienen zweierlei:
 * als Prüfmenge gegen selbstblockierende Regeln (siehe
 * `findSelfBlockingRules`) und als Grundlage für die Schutz-Allow-Regeln im
 * Regel-Generator.
 *
 * @type {readonly string[]}
 */
export const PRESET_SOURCE_URLS = Object.freeze(
  Object.values(PRESETS).flatMap((preset) => preset.urls)
);

/**
 * Die Hostnamen dazu, ohne Duplikate.
 * @type {readonly string[]}
 */
export const PRESET_SOURCE_HOSTS = Object.freeze([
  ...new Set(
    PRESET_SOURCE_URLS.map((url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    }).filter(Boolean)
  ),
]);

/** Wie lange eine heruntergeladene Liste als aktuell gilt. */
export const PRESET_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} PresetMeta
 * @property {boolean} enabled
 * @property {number} ruleCount Wie viele Regeln nach dem Parsen übrig blieben.
 * @property {number} sourceEntries Wie viele Einträge die Quelle hatte.
 * @property {number|null} updatedAt Epoch-Millisekunden des letzten Downloads.
 * @property {string|null} lastError Fehlermeldung des letzten Versuchs.
 * @property {string|null} sourceUrl Welche der Quellen zuletzt funktioniert hat.
 */

/**
 * Leerer Metadatensatz.
 * @returns {PresetMeta}
 */
export function createEmptyPresetMeta() {
  return {
    enabled: false,
    ruleCount: 0,
    sourceEntries: 0,
    updatedAt: null,
    lastError: null,
    sourceUrl: null,
  };
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
    if (typeof meta.sourceUrl === 'string' && meta.sourceUrl.length > 0) {
      result[id].sourceUrl = meta.sourceUrl.slice(0, 300);
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
 * @returns {Array<PresetDefinition & PresetMeta & {isStale: boolean, url: string}>}
 */
export function describePresets(meta, now = Date.now()) {
  return Object.values(PRESETS).map((definition) => {
    const entry = meta[definition.id] ?? createEmptyPresetMeta();
    return {
      ...definition,
      ...entry,
      // Für die Anzeige: die zuletzt erfolgreiche Quelle, sonst die bevorzugte.
      url: entry.sourceUrl ?? definition.urls[0],
      isStale:
        entry.enabled && (entry.updatedAt === null || now - entry.updatedAt > PRESET_MAX_AGE_MS),
    };
  });
}

/**
 * Prüft, ob eine URL als Filterlistenquelle zulässig ist.
 *
 * Nur HTTPS, keine IP-Literale, keine Zugangsdaten in der URL.
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
