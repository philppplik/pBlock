/**
 * Reine Einstellungs-Logik: Normalisieren, Ändern, Validieren.
 *
 * Alle Funktionen hier sind **pur** und geben neue Objekte zurück. Kein Zugriff
 * auf `chrome`, kein Zugriff aufs DOM. Genau deshalb lassen sie sich vollständig
 * unit-testen — in v4 war dieselbe Logik untrennbar mit `chrome.storage.sync`
 * verwoben und damit faktisch ungetestet.
 */

import { PROTECTION_LEVELS, SETTINGS_SCHEMA_VERSION } from './constants.js';
import {
  CATEGORY_TAXONOMY,
  PROTECTION_LEVEL_PRESETS,
  createDefaultSettings,
} from './settings-schema.js';
import { isPlausibleDomain, parseDomainInput } from './domain.js';
import { LOG_LEVELS } from './logger.js';

/**
 * @typedef {object} ElementRule
 * @property {string} selector CSS-Selektor.
 * @property {string|null} domain Host, wenn nur seitenspezifisch.
 * @property {boolean} siteOnly
 * @property {number} createdAt Epoch-Millisekunden.
 */

/**
 * @typedef {object} Settings
 * @property {number} schemaVersion
 * @property {boolean} masterEnabled
 * @property {'simple'|'expert'} uiMode
 * @property {number} protectionLevel
 * @property {Record<string, {enabled: boolean, subcategories: Record<string, {enabled: boolean}>}>} categories
 * @property {string[]} whitelist
 * @property {Array<{urlFilter: string}>} customRules
 * @property {ElementRule[]} elementRules
 * @property {boolean} cosmeticFiltersEnabled
 * @property {boolean} antiAdblockDefuseEnabled
 * @property {{showBadge: boolean, showNotifications: boolean, theme: string, reduceMotion: boolean}} ui
 * @property {{logLevel: string}} diagnostics
 */

/** Obergrenzen, damit kaputte oder böswillige Importe den Storage nicht sprengen. */
export const LIMITS = Object.freeze({
  WHITELIST: 5_000,
  CUSTOM_RULES: 2_000,
  ELEMENT_RULES: 5_000,
  SELECTOR_LENGTH: 500,
  URL_FILTER_LENGTH: 300,
});

/**
 * Führt gespeicherte Werte mit den Standardwerten zusammen.
 *
 * Regeln:
 *  - Unbekannte Schlüssel werden verworfen (kein Storage-Wildwuchs).
 *  - Typfehler fallen auf den Standard zurück, statt später zur Laufzeit zu knallen.
 *  - Kategorien/Unterkategorien, die es im aktuellen Schema nicht mehr gibt, verschwinden.
 *  - Neue Kategorien aus einem Update bekommen ihren Standardwert.
 *
 * @param {unknown} stored Rohwert aus dem Storage — darf alles sein, auch `undefined`.
 * @returns {Settings}
 */
export function normalizeSettings(stored) {
  const result = createDefaultSettings();
  if (!isPlainObject(stored)) return result;

  if (typeof stored.masterEnabled === 'boolean') result.masterEnabled = stored.masterEnabled;
  if (stored.uiMode === 'simple' || stored.uiMode === 'expert') result.uiMode = stored.uiMode;
  if (PROTECTION_LEVELS.includes(stored.protectionLevel)) {
    result.protectionLevel = stored.protectionLevel;
  }
  if (typeof stored.cosmeticFiltersEnabled === 'boolean') {
    result.cosmeticFiltersEnabled = stored.cosmeticFiltersEnabled;
  }
  if (typeof stored.antiAdblockDefuseEnabled === 'boolean') {
    result.antiAdblockDefuseEnabled = stored.antiAdblockDefuseEnabled;
  }

  applyStoredCategories(result, stored.categories);

  result.whitelist = normalizeWhitelist(stored.whitelist);
  result.customRules = normalizeCustomRules(stored.customRules);
  result.elementRules = normalizeElementRules(stored.elementRules);

  applyStoredUi(result, stored.ui);

  if (isPlainObject(stored.diagnostics) && LOG_LEVELS.includes(stored.diagnostics.logLevel)) {
    result.diagnostics.logLevel = stored.diagnostics.logLevel;
  }

  result.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return result;
}

/**
 * Überträgt gespeicherte Kategorie-Schalter auf die Standardstruktur.
 *
 * Es werden ausschließlich Booleans übernommen und nur für Kategorien, die es im
 * aktuellen Schema noch gibt. Alles andere fällt weg.
 *
 * @param {Settings} target Wird in-place verändert (lokal erzeugtes Objekt).
 * @param {unknown} storedCategories
 */
function applyStoredCategories(target, storedCategories) {
  if (!isPlainObject(storedCategories)) return;

  for (const [categoryId, categoryValue] of Object.entries(storedCategories)) {
    const category = target.categories[categoryId];
    if (!category || !isPlainObject(categoryValue)) continue;

    if (typeof categoryValue.enabled === 'boolean') category.enabled = categoryValue.enabled;
    if (!isPlainObject(categoryValue.subcategories)) continue;

    for (const [subId, subValue] of Object.entries(categoryValue.subcategories)) {
      const subcategory = category.subcategories[subId];
      if (!subcategory || !isPlainObject(subValue)) continue;
      if (typeof subValue.enabled === 'boolean') subcategory.enabled = subValue.enabled;
    }
  }
}

/**
 * Überträgt gespeicherte Oberflächen-Einstellungen.
 * @param {Settings} target Wird in-place verändert (lokal erzeugtes Objekt).
 * @param {unknown} storedUi
 */
function applyStoredUi(target, storedUi) {
  if (!isPlainObject(storedUi)) return;

  if (typeof storedUi.showBadge === 'boolean') target.ui.showBadge = storedUi.showBadge;
  if (typeof storedUi.showNotifications === 'boolean') {
    target.ui.showNotifications = storedUi.showNotifications;
  }
  if (['system', 'dark', 'light'].includes(storedUi.theme)) target.ui.theme = storedUi.theme;
  if (typeof storedUi.reduceMotion === 'boolean') target.ui.reduceMotion = storedUi.reduceMotion;
}

/**
 * Bereinigt eine Whitelist: normalisiert, verwirft Unsinn, entfernt Duplikate, begrenzt die Länge.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeWhitelist(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const domain = parseDomainInput(entry);
    if (domain) seen.add(domain);
    if (seen.size >= LIMITS.WHITELIST) break;
  }
  return [...seen].sort();
}

/**
 * Bereinigt eigene Regeln.
 * @param {unknown} value
 * @returns {Array<{urlFilter: string}>}
 */
export function normalizeCustomRules(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  /** @type {Array<{urlFilter: string}>} */
  const rules = [];
  for (const entry of value) {
    // v4 speicherte teils nackte Strings, teils Objekte. Beides wird akzeptiert.
    let raw = null;
    if (typeof entry === 'string') raw = entry;
    else if (isPlainObject(entry) && typeof entry.urlFilter === 'string') raw = entry.urlFilter;
    if (raw === null) continue;

    const urlFilter = raw.trim();
    if (urlFilter.length === 0 || urlFilter.length > LIMITS.URL_FILTER_LENGTH) continue;
    if (seen.has(urlFilter)) continue;
    seen.add(urlFilter);
    rules.push({ urlFilter });
    if (rules.length >= LIMITS.CUSTOM_RULES) break;
  }
  return rules;
}

/**
 * Bereinigt Element-Regeln aus dem Element-Picker.
 * @param {unknown} value
 * @returns {ElementRule[]}
 */
export function normalizeElementRules(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  /** @type {ElementRule[]} */
  const rules = [];
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.selector !== 'string') continue;
    const selector = entry.selector.trim();
    if (selector.length === 0 || selector.length > LIMITS.SELECTOR_LENGTH) continue;

    const siteOnly = entry.siteOnly === true;
    const domain =
      siteOnly && typeof entry.domain === 'string' ? parseDomainInput(entry.domain) : null;
    // Eine seitenspezifische Regel ohne gültige Domain ergibt keinen Sinn.
    if (siteOnly && !domain) continue;

    const key = `${siteOnly ? domain : '*'}|${selector}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rules.push({
      selector,
      domain,
      siteOnly,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
    });
    if (rules.length >= LIMITS.ELEMENT_RULES) break;
  }
  return rules;
}

/**
 * Wendet eine Schutzstufe an.
 *
 * **Verhaltensänderung gegenüber v4:** Nur die Kategorie-Schalter werden gesetzt.
 * Feineinstellungen auf Unterkategorie-Ebene bleiben erhalten. Wer zuvor
 * „Fehler-Tracking“ bewusst eingeschaltet hat, verliert das nicht mehr, nur weil
 * er den Regler bewegt.
 *
 * @param {Settings} settings
 * @param {number} level Eine der Stufen aus {@link PROTECTION_LEVELS}.
 * @returns {Settings} Neues Objekt; das Original bleibt unverändert.
 */
export function applyProtectionLevel(settings, level) {
  if (!PROTECTION_LEVELS.includes(level)) return settings;
  const preset = PROTECTION_LEVEL_PRESETS[level];
  const next = cloneSettings(settings);
  next.protectionLevel = level;
  for (const [categoryId, enabled] of Object.entries(preset)) {
    if (next.categories[categoryId]) next.categories[categoryId].enabled = enabled;
  }
  return next;
}

/**
 * Schaltet eine Kategorie um.
 * @param {Settings} settings
 * @param {string} categoryId
 * @param {boolean} enabled
 * @returns {Settings}
 */
export function setCategoryEnabled(settings, categoryId, enabled) {
  if (!CATEGORY_TAXONOMY[categoryId]) return settings;
  const next = cloneSettings(settings);
  next.categories[categoryId].enabled = Boolean(enabled);
  return next;
}

/**
 * Schaltet eine Unterkategorie um.
 * @param {Settings} settings
 * @param {string} categoryId
 * @param {string} subcategoryId
 * @param {boolean} enabled
 * @returns {Settings}
 */
export function setSubcategoryEnabled(settings, categoryId, subcategoryId, enabled) {
  const category = CATEGORY_TAXONOMY[categoryId];
  if (!category || !category.subcategories[subcategoryId]) return settings;
  const next = cloneSettings(settings);
  next.categories[categoryId].subcategories[subcategoryId].enabled = Boolean(enabled);
  return next;
}

/**
 * Nimmt eine Domain in die Whitelist auf.
 * @param {Settings} settings
 * @param {string} input Rohe Nutzereingabe.
 * @returns {{settings: Settings, added: string|null}} `added` ist `null`, wenn die Eingabe
 *   ungültig war oder die Domain bereits enthalten ist.
 */
export function addToWhitelist(settings, input) {
  const domain = parseDomainInput(input);
  if (!domain || !isPlausibleDomain(domain)) return { settings, added: null };
  if (settings.whitelist.includes(domain)) return { settings, added: null };
  if (settings.whitelist.length >= LIMITS.WHITELIST) return { settings, added: null };

  const next = cloneSettings(settings);
  next.whitelist = [...next.whitelist, domain].sort();
  return { settings: next, added: domain };
}

/**
 * Entfernt eine Domain aus der Whitelist.
 * @param {Settings} settings
 * @param {string} domain
 * @returns {Settings}
 */
export function removeFromWhitelist(settings, domain) {
  const normalized = parseDomainInput(domain);
  if (!normalized || !settings.whitelist.includes(normalized)) return settings;
  const next = cloneSettings(settings);
  next.whitelist = next.whitelist.filter((entry) => entry !== normalized);
  return next;
}

/**
 * Fügt eine eigene Blockier-Regel hinzu.
 * @param {Settings} settings
 * @param {string} urlFilter
 * @returns {{settings: Settings, added: boolean}}
 */
export function addCustomRule(settings, urlFilter) {
  if (typeof urlFilter !== 'string') return { settings, added: false };
  const value = urlFilter.trim();
  if (value.length === 0 || value.length > LIMITS.URL_FILTER_LENGTH) {
    return { settings, added: false };
  }
  if (settings.customRules.some((rule) => rule.urlFilter === value)) {
    return { settings, added: false };
  }
  if (settings.customRules.length >= LIMITS.CUSTOM_RULES) return { settings, added: false };

  const next = cloneSettings(settings);
  next.customRules = [...next.customRules, { urlFilter: value }];
  return { settings: next, added: true };
}

/**
 * Entfernt eine eigene Regel über ihren Index.
 * @param {Settings} settings
 * @param {number} index
 * @returns {Settings}
 */
export function removeCustomRule(settings, index) {
  if (!Number.isInteger(index) || index < 0 || index >= settings.customRules.length) {
    return settings;
  }
  const next = cloneSettings(settings);
  next.customRules = next.customRules.filter((_rule, i) => i !== index);
  return next;
}

/**
 * Legt eine Element-Regel an.
 * @param {Settings} settings
 * @param {{selector: string, domain?: string|null, siteOnly?: boolean}} input
 * @param {number} [now=Date.now()]
 * @returns {{settings: Settings, added: ElementRule|null}}
 */
export function addElementRule(settings, input, now = Date.now()) {
  const [rule] = normalizeElementRules([{ ...input, createdAt: now }]);
  if (!rule) return { settings, added: null };

  const duplicate = settings.elementRules.some(
    (existing) => existing.selector === rule.selector && existing.domain === rule.domain
  );
  if (duplicate) return { settings, added: null };
  if (settings.elementRules.length >= LIMITS.ELEMENT_RULES) return { settings, added: null };

  const next = cloneSettings(settings);
  next.elementRules = [...next.elementRules, rule];
  return { settings: next, added: rule };
}

/**
 * Entfernt eine Element-Regel über ihren Index.
 * @param {Settings} settings
 * @param {number} index
 * @returns {{settings: Settings, removed: ElementRule|null}}
 */
export function removeElementRule(settings, index) {
  if (!Number.isInteger(index) || index < 0 || index >= settings.elementRules.length) {
    return { settings, removed: null };
  }
  const next = cloneSettings(settings);
  const [removed] = next.elementRules.splice(index, 1);
  return { settings: next, removed };
}

/**
 * Macht die zuletzt angelegte Element-Regel rückgängig.
 * @param {Settings} settings
 * @returns {{settings: Settings, removed: ElementRule|null}}
 */
export function undoLastElementRule(settings) {
  if (settings.elementRules.length === 0) return { settings, removed: null };
  return removeElementRule(settings, settings.elementRules.length - 1);
}

/**
 * Löscht alle Element-Regeln.
 *
 * In v4 blieben die zugehörigen Cosmetic-Selektoren dabei bestehen — die Elemente
 * blieben also versteckt, obwohl die Regel weg war. Da Element-Regeln jetzt die
 * einzige Quelle benutzerdefinierter Selektoren sind, kann das nicht mehr passieren.
 *
 * @param {Settings} settings
 * @returns {Settings}
 */
export function clearElementRules(settings) {
  if (settings.elementRules.length === 0) return settings;
  const next = cloneSettings(settings);
  next.elementRules = [];
  return next;
}

/**
 * Liefert die Element-Regeln, die auf einem Host greifen.
 * @param {Settings} settings
 * @param {string|null} hostname
 * @returns {ElementRule[]}
 */
export function getElementRulesForHost(settings, hostname) {
  return settings.elementRules.filter((rule) => {
    if (!rule.siteOnly) return true;
    if (!hostname || !rule.domain) return false;
    return hostname === rule.domain || hostname.endsWith(`.${rule.domain}`);
  });
}

/**
 * Serialisiert Einstellungen für den Export.
 * @param {Settings} settings
 * @param {string} appVersion
 * @param {Date} [now=new Date()]
 * @returns {string} Formatiertes JSON.
 */
export function exportSettings(settings, appVersion, now = new Date()) {
  return JSON.stringify(
    {
      _meta: {
        app: 'pBlock',
        appVersion,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        exportedAt: now.toISOString(),
      },
      settings,
    },
    null,
    2
  );
}

/**
 * Liest und validiert eine Sicherungsdatei.
 *
 * v4 gab den JSON-Inhalt ungeprüft an `chrome.storage.sync.set` weiter. Eine
 * manipulierte oder schlicht kaputte Datei konnte damit beliebige Schlüssel in
 * den Storage schreiben. Hier läuft alles durch {@link normalizeSettings}.
 *
 * @param {string} json
 * @returns {{ok: true, settings: Settings} | {ok: false, error: string}}
 */
export function importSettings(json) {
  if (typeof json !== 'string' || json.trim().length === 0) {
    return { ok: false, error: 'Die Datei ist leer.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Die Datei enthält kein gültiges JSON.' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Unerwartetes Format: Es wurde ein JSON-Objekt erwartet.' };
  }

  // Neues Format hat `settings`; v4-Exporte waren das nackte Einstellungsobjekt.
  const candidate = isPlainObject(parsed.settings) ? parsed.settings : parsed;
  return { ok: true, settings: normalizeSettings(migrateLegacySettings(candidate)) };
}

/**
 * Übersetzt v4-Feldnamen auf das aktuelle Schema.
 *
 * Damit gehen die Einstellungen bestehender Nutzer beim Update nicht verloren.
 *
 * @param {unknown} legacy
 * @returns {Record<string, unknown>}
 */
export function migrateLegacySettings(legacy) {
  if (!isPlainObject(legacy)) return {};
  // Bereits aktuelles Schema? Dann unverändert durchreichen.
  if (legacy.schemaVersion === SETTINGS_SCHEMA_VERSION) return legacy;

  const migrated = { ...legacy };

  // v4: filterLevel: 'simple' | 'expert'  →  uiMode
  if (
    migrated.uiMode === undefined &&
    (legacy.filterLevel === 'simple' || legacy.filterLevel === 'expert')
  ) {
    migrated.uiMode = legacy.filterLevel;
  }
  // v4: sliderValue  →  protectionLevel
  if (migrated.protectionLevel === undefined && PROTECTION_LEVELS.includes(legacy.sliderValue)) {
    migrated.protectionLevel = legacy.sliderValue;
  }
  // v4: settings.showBadge / showNotifications  →  ui.*
  if (isPlainObject(legacy.settings) && !isPlainObject(legacy.ui)) {
    migrated.ui = {
      showBadge: legacy.settings.showBadge,
      showNotifications: legacy.settings.showNotifications,
    };
  }
  // v4: customCosmeticRules war eine flache Selektorliste ohne Metadaten.
  if (Array.isArray(legacy.customCosmeticRules)) {
    const fromCosmetic = legacy.customCosmeticRules
      .filter((selector) => typeof selector === 'string')
      .map((selector) => ({ selector, siteOnly: false, domain: null, createdAt: Date.now() }));
    const existing = Array.isArray(legacy.elementRules) ? legacy.elementRules : [];
    migrated.elementRules = [...existing, ...fromCosmetic];
  }

  delete migrated.filterLevel;
  delete migrated.sliderValue;
  delete migrated.customCosmeticRules;
  delete migrated.statistics; // Statistik liegt in einem eigenen Storage-Schlüssel.

  return migrated;
}

/**
 * Tiefe Kopie der Einstellungen.
 *
 * `structuredClone` steht in Service Worker, Content-Script und Node ≥ 17 zur
 * Verfügung; der JSON-Umweg ist nur die Rückfallebene.
 *
 * @param {Settings} settings
 * @returns {Settings}
 */
export function cloneSettings(settings) {
  if (typeof structuredClone === 'function') return structuredClone(settings);
  return JSON.parse(JSON.stringify(settings));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
