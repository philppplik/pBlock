/**
 * Storage-Adapter für den Service Worker.
 *
 * ## Warum `chrome.storage.local` statt `chrome.storage.sync`
 *
 * v4 legte Einstellungen in `sync` ab. Dessen Grenzen sind hart: 102.400 Bytes
 * insgesamt, 8.192 Bytes pro Eintrag und 1.800 Schreibvorgänge pro Stunde. Das
 * `categories`-Objekt enthielt in v4 sämtliche deutschen Labels und
 * Beschreibungstexte und kam allein schon auf über 4 KB. Zusammen mit Whitelist,
 * eigenen Regeln und Element-Regeln war das Limit realistisch erreichbar — und
 * `sync` meldet das Überschreiten nur über `chrome.runtime.lastError`, das v4 an
 * keiner Stelle geprüft hat. Einstellungen gingen also stillschweigend verloren.
 *
 * `local` bietet standardmäßig 10 MB und kein Schreiblimit. Preis dafür: keine
 * automatische Geräte-Synchronisation. Der Ausgleich ist der Export/Import in den
 * Einstellungen, der zusätzlich Statistik und Filterlisten mitnimmt — was `sync`
 * ohnehin nie konnte. Siehe docs/architektur.md.
 *
 * ## Cache
 *
 * Der Service Worker wird von Chrome nach ~30 Sekunden Untätigkeit beendet. Beim
 * nächsten Ereignis startet er neu und der Cache ist leer — das ist in Ordnung.
 * Solange er läuft, spart der Cache bei jedem blockierten Request einen
 * Storage-Zugriff. `chrome.storage.onChanged` hält ihn aktuell, auch wenn eine
 * Optionsseite schreibt.
 */

import { STORAGE_KEYS } from '../core/constants.js';
import { normalizeSettings } from '../core/settings.js';
import { normalizeStatistics } from '../core/statistics.js';
import { normalizeSiteStats } from '../core/site-stats.js';
import { normalizePresetMeta } from '../core/presets.js';
import { describeError } from '../core/logger.js';

/** @type {Map<string, unknown>} */
const cache = new Map();

/**
 * Liest einen Rohwert aus `chrome.storage.local`.
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function readRaw(key) {
  const result = await chrome.storage.local.get(key);
  return result?.[key];
}

/**
 * Schreibt einen Rohwert und aktualisiert den Cache.
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeRaw(key, value) {
  cache.set(key, value);
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Liest einen Wert über den Cache und normalisiert ihn.
 * @template T
 * @param {string} key
 * @param {(raw: unknown) => T} normalize
 * @returns {Promise<T>}
 */
async function readCached(key, normalize) {
  if (cache.has(key)) return /** @type {T} */ (cache.get(key));
  const value = normalize(await readRaw(key));
  cache.set(key, value);
  return value;
}

/**
 * Aktuelle Einstellungen.
 * @returns {Promise<import('../core/settings.js').Settings>}
 */
export function readSettings() {
  return readCached(STORAGE_KEYS.SETTINGS, normalizeSettings);
}

/**
 * Schreibt Einstellungen.
 * @param {import('../core/settings.js').Settings} settings
 * @returns {Promise<void>}
 */
export function writeSettings(settings) {
  return writeRaw(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * Aktuelle Statistik.
 * @returns {Promise<import('../core/statistics.js').StatisticsState>}
 */
export function readStatistics() {
  return readCached(STORAGE_KEYS.STATISTICS, normalizeStatistics);
}

/**
 * Schreibt die Statistik.
 * @param {import('../core/statistics.js').StatisticsState} statistics
 * @returns {Promise<void>}
 */
export function writeStatistics(statistics) {
  return writeRaw(STORAGE_KEYS.STATISTICS, statistics);
}

/**
 * Aktuelle Per-Site-Statistik.
 * @returns {Promise<import('../core/site-stats.js').SiteStatsState>}
 */
export function readSiteStats() {
  return readCached(STORAGE_KEYS.SITE_STATS, normalizeSiteStats);
}

/**
 * Schreibt die Per-Site-Statistik.
 * @param {import('../core/site-stats.js').SiteStatsState} siteStats
 * @returns {Promise<void>}
 */
export function writeSiteStats(siteStats) {
  return writeRaw(STORAGE_KEYS.SITE_STATS, siteStats);
}

/**
 * Metadaten der Filterlisten.
 * @returns {Promise<Record<string, import('../core/presets.js').PresetMeta>>}
 */
export function readPresetMeta() {
  return readCached(STORAGE_KEYS.PRESET_META, normalizePresetMeta);
}

/**
 * Schreibt die Metadaten der Filterlisten.
 * @param {Record<string, import('../core/presets.js').PresetMeta>} meta
 * @returns {Promise<void>}
 */
export function writePresetMeta(meta) {
  return writeRaw(STORAGE_KEYS.PRESET_META, meta);
}

/**
 * Liest die gespeicherten Regeln einer Filterliste.
 *
 * Bewusst **nicht** im Cache: Diese Arrays sind mit Abstand die größten Objekte
 * im Storage. Sie werden nur beim Anwenden der Regeln gebraucht, nicht in jedem
 * Ereignis — sie dauerhaft im Speicher des Service Workers zu halten wäre reine
 * Verschwendung.
 *
 * @param {string} presetId
 * @returns {Promise<Array<object>>}
 */
export async function readPresetRules(presetId) {
  const key = `${STORAGE_KEYS.PRESET_RULES}:${presetId}`;
  const stored = await readRaw(key);
  return Array.isArray(stored?.rules) ? stored.rules : [];
}

/**
 * Schreibt die Regeln einer Filterliste.
 * @param {string} presetId
 * @param {Array<object>} rules
 * @returns {Promise<void>}
 */
export async function writePresetRules(presetId, rules) {
  const key = `${STORAGE_KEYS.PRESET_RULES}:${presetId}`;
  await chrome.storage.local.set({ [key]: { rules, parsedAt: Date.now() } });
}

/**
 * Entfernt die Regeln einer Filterliste.
 * @param {string} presetId
 * @returns {Promise<void>}
 */
export async function removePresetRules(presetId) {
  await chrome.storage.local.remove(`${STORAGE_KEYS.PRESET_RULES}:${presetId}`);
}

/**
 * Liest den Onboarding-Zustand.
 * @returns {Promise<{completed: boolean, version: string|null}>}
 */
export async function readOnboarding() {
  const stored = await readRaw(STORAGE_KEYS.ONBOARDING);
  return {
    completed: stored?.completed === true,
    version: typeof stored?.version === 'string' ? stored.version : null,
  };
}

/**
 * Schreibt den Onboarding-Zustand.
 * @param {{completed: boolean, version: string|null}} value
 * @returns {Promise<void>}
 */
export function writeOnboarding(value) {
  return writeRaw(STORAGE_KEYS.ONBOARDING, value);
}

/**
 * Setzt alles zurück — Einstellungen, Statistik und heruntergeladene Listen.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  cache.clear();
  await chrome.storage.local.clear();
}

/**
 * Verwirft den Cache, damit der nächste Lesezugriff wieder aus dem Storage kommt.
 */
export function invalidateCache() {
  cache.clear();
}

/**
 * Ermittelt die Storage-Auslastung für die Diagnoseansicht.
 * @returns {Promise<{bytesInUse: number, quotaBytes: number, percentage: number}>}
 */
export async function getStorageUsage() {
  const quotaBytes = chrome.storage.local.QUOTA_BYTES ?? 10 * 1024 * 1024;
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse(null);
    return {
      bytesInUse,
      quotaBytes,
      percentage: Math.round((bytesInUse / quotaBytes) * 100),
    };
  } catch {
    // `getBytesInUse` ist nicht in jeder Umgebung verfügbar (z. B. in manchen
    // Chromium-Derivaten). Die Diagnose darf daran nicht scheitern.
    return { bytesInUse: -1, quotaBytes, percentage: -1 };
  }
}

/**
 * Hält den Cache aktuell, wenn eine andere Seite schreibt.
 *
 * Ohne das würde eine Änderung auf der Optionsseite im Service Worker erst nach
 * dessen nächstem Neustart sichtbar — in v4 eine wiederkehrende Ursache dafür,
 * dass eine Einstellung „nicht greift“.
 *
 * @param {(changedKeys: string[]) => void} [onChange]
 */
export function watchExternalChanges(onChange) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const keys = Object.keys(changes);
    for (const key of keys) cache.delete(key);
    if (onChange) {
      try {
        onChange(keys);
      } catch (error) {
        console.error('[pBlock] Storage-Beobachter fehlgeschlagen:', describeError(error));
      }
    }
  });
}
