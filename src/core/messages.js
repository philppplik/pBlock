/**
 * Nachrichtentypen zwischen Service Worker, Content-Scripts und UI-Seiten.
 *
 * Warum Konstanten statt String-Literalen: In v4 waren die Typen an ~40 Stellen
 * als Literal verstreut. Ein Tippfehler fiel erst zur Laufzeit auf — und zwar als
 * stilles „Unknown message type“. Mit Konstanten bricht schon der Lint.
 */
export const MSG = Object.freeze({
  // Zustand
  GET_POPUP_STATE: 'state:popup',
  GET_OPTIONS_STATE: 'state:options',
  GET_CONTENT_CONFIG: 'state:content',

  // Schalter
  SET_MASTER_ENABLED: 'settings:masterEnabled',
  SET_UI_MODE: 'settings:uiMode',
  SET_PROTECTION_LEVEL: 'settings:protectionLevel',
  SET_CATEGORY: 'settings:category',
  SET_SUBCATEGORY: 'settings:subcategory',

  // Whitelist
  WHITELIST_ADD: 'whitelist:add',
  WHITELIST_REMOVE: 'whitelist:remove',
  WHITELIST_TOGGLE_ACTIVE_TAB: 'whitelist:toggleActiveTab',

  // Eigene Regeln
  CUSTOM_RULE_ADD: 'customRule:add',
  CUSTOM_RULE_REMOVE: 'customRule:remove',

  // Element-Picker
  PICKER_ACTIVATE: 'picker:activate',
  PICKER_DEACTIVATE: 'picker:deactivate',
  ELEMENT_RULE_ADD: 'elementRule:add',
  ELEMENT_RULE_REMOVE: 'elementRule:remove',
  ELEMENT_RULE_UNDO: 'elementRule:undo',
  ELEMENT_RULE_CLEAR: 'elementRule:clear',

  // Filterlisten
  PRESET_LIST: 'preset:list',
  PRESET_TOGGLE: 'preset:toggle',
  PRESET_UPDATE: 'preset:update',
  PRESET_UPDATE_ALL: 'preset:updateAll',

  // Statistik
  STATS_GET: 'stats:get',
  STATS_HISTORY: 'stats:history',
  STATS_TOP_DOMAINS: 'stats:topDomains',
  STATS_TOP_SITES: 'stats:topSites',
  STATS_RESET: 'stats:reset',
  STATS_RECORD_COSMETIC: 'stats:recordCosmetic',

  // Sicherung
  SETTINGS_EXPORT: 'settings:export',
  SETTINGS_IMPORT: 'settings:import',
  SETTINGS_RESET: 'settings:reset',

  // Diagnose
  DIAGNOSTICS_GET: 'diagnostics:get',
  DIAGNOSTICS_EXPORT: 'diagnostics:export',
  DIAGNOSTICS_SET_LEVEL: 'diagnostics:setLevel',
  DIAGNOSTICS_SELFTEST: 'diagnostics:selftest',

  // Onboarding
  ONBOARDING_COMPLETE: 'onboarding:complete',

  // Push vom Service Worker an geöffnete UI-Instanzen
  PUSH_STATS: 'push:stats',
  PUSH_SETTINGS: 'push:settings',
});

/** Name des Ports, über den das Popup Live-Updates empfängt. */
export const LIVE_PORT_NAME = 'pblock-live';

/**
 * Baut eine erfolgreiche Antwort.
 * @template T
 * @param {T} data
 * @returns {{ok: true, data: T}}
 */
export function ok(data = null) {
  return { ok: true, data };
}

/**
 * Baut eine Fehlerantwort. Die UI kann damit gezielt reagieren statt `undefined` zu raten.
 * @param {string} message Für Menschen lesbare Ursache.
 * @param {string} [code] Maschinenlesbarer Fehlercode.
 * @returns {{ok: false, error: {message: string, code: string}}}
 */
export function fail(message, code = 'UNKNOWN') {
  return { ok: false, error: { message, code } };
}
