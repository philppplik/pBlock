/**
 * Statistik pro Website — reine Reduzierer.
 *
 * Gegenüber v4 kommen zwei Dinge dazu, die im Betrieb wirklich zählen:
 *
 * 1. **Eine Obergrenze.** v4 legte für jeden je besuchten Host einen Eintrag an
 *    und löschte nie. Nach ein paar Monaten Surfen stand da ein Objekt mit
 *    zehntausenden Schlüsseln, das bei *jedem* blockierten Request komplett
 *    gelesen, verändert und zurückgeschrieben wurde.
 * 2. **Tagesgenaue Werte** statt eines `today`-Zählers mit Rollover-Logik —
 *    aus denselben Gründen wie in `statistics.js`.
 */

import { SITE_STATS_LIMIT, STATS_SCHEMA_VERSION } from './constants.js';
import { fromDayKey, lastDayKeys, toDayKey } from './time.js';

/**
 * @typedef {object} SiteBucket
 * @property {number} total
 * @property {Record<string, number>} days Tagesschlüssel → Anzahl.
 * @property {Record<string, number>} categories
 * @property {number} lastSeen Epoch-Millisekunden.
 */

/**
 * @typedef {object} SiteStatsState
 * @property {number} schemaVersion
 * @property {Record<string, SiteBucket>} sites
 */

/** Wie viele Tage pro Website aufbewahrt werden. */
export const SITE_HISTORY_DAYS = 30;

/**
 * @returns {SiteStatsState}
 */
export function createEmptySiteStats() {
  return { schemaVersion: STATS_SCHEMA_VERSION, sites: {} };
}

/**
 * Repariert einen aus dem Storage gelesenen Zustand.
 * @param {unknown} stored
 * @returns {SiteStatsState}
 */
export function normalizeSiteStats(stored) {
  const base = createEmptySiteStats();
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return base;

  // v4 speicherte die Hosts direkt auf oberster Ebene, ohne `sites`-Wrapper.
  const source = typeof stored.sites === 'object' && stored.sites !== null ? stored.sites : stored;

  for (const [hostname, bucket] of Object.entries(source)) {
    if (typeof hostname !== 'string' || hostname === 'schemaVersion') continue;
    if (typeof bucket !== 'object' || bucket === null) continue;
    base.sites[hostname] = normalizeSiteBucket(bucket);
  }

  return base;
}

/**
 * Repariert den Datensatz einer einzelnen Website.
 * @param {Record<string, unknown>} bucket
 * @returns {SiteBucket}
 */
function normalizeSiteBucket(bucket) {
  /** @type {SiteBucket} */
  const clean = {
    total: Number.isFinite(bucket.total) && bucket.total > 0 ? Math.floor(bucket.total) : 0,
    days: {},
    categories: {},
    lastSeen: Number.isFinite(bucket.lastSeen) ? bucket.lastSeen : 0,
  };

  if (typeof bucket.days === 'object' && bucket.days !== null) {
    for (const [dayKey, count] of Object.entries(bucket.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey) && Number.isFinite(count) && count > 0) {
        clean.days[dayKey] = Math.floor(count);
      }
    }
  }

  if (typeof bucket.categories === 'object' && bucket.categories !== null) {
    for (const [category, count] of Object.entries(bucket.categories)) {
      if (Number.isFinite(count) && count > 0) clean.categories[category] = Math.floor(count);
    }
  }

  return clean;
}

/**
 * Verbucht Treffer für eine Website.
 * @param {SiteStatsState} state
 * @param {object} event
 * @param {string} event.hostname
 * @param {string|null} [event.category]
 * @param {number} [event.count=1]
 * @param {Date} [event.at=new Date()]
 * @returns {SiteStatsState}
 */
export function recordSiteBlocks(state, event) {
  const { hostname, category = null, count = 1, at = new Date() } = event ?? {};
  if (typeof hostname !== 'string' || hostname.length === 0) return state;
  if (!Number.isFinite(count) || count <= 0) return state;

  const amount = Math.floor(count);
  const dayKey = toDayKey(at);
  const previous = state.sites[hostname] ?? { total: 0, days: {}, categories: {}, lastSeen: 0 };

  /** @type {SiteBucket} */
  const bucket = {
    total: previous.total + amount,
    days: { ...previous.days, [dayKey]: (previous.days[dayKey] ?? 0) + amount },
    categories: { ...previous.categories },
    lastSeen: at.getTime(),
  };
  if (category) bucket.categories[category] = (bucket.categories[category] ?? 0) + amount;

  return pruneSiteStats({ ...state, sites: { ...state.sites, [hostname]: bucket } }, at);
}

/**
 * Kürzt Tagesverlauf und Anzahl der Websites.
 *
 * Fällt die Grenze, fliegen die Hosts mit den wenigsten Treffern zuerst; bei
 * Gleichstand entscheidet, wer am längsten nicht mehr gesehen wurde.
 *
 * @param {SiteStatsState} state
 * @param {Date} [now=new Date()]
 * @returns {SiteStatsState}
 */
export function pruneSiteStats(state, now = new Date()) {
  // Stichtag aus dem jüngsten vorhandenen Tag ableiten — ausführliche Begründung
  // in `statistics.js`: Ereignisse treffen nicht zwingend in zeitlicher
  // Reihenfolge ein, und das Ergebnis soll nicht davon abhängen, wann aufgeräumt wird.
  let newestKnown = toDayKey(now);
  for (const bucket of Object.values(state.sites)) {
    for (const dayKey of Object.keys(bucket.days)) {
      if (dayKey > newestKnown) newestKnown = dayKey;
    }
  }
  const [cutoff] = lastDayKeys(SITE_HISTORY_DAYS, fromDayKey(newestKnown) ?? now);
  /** @type {Record<string, SiteBucket>} */
  const sites = {};
  let changed = false;

  for (const [hostname, bucket] of Object.entries(state.sites)) {
    /** @type {Record<string, number>} */
    const days = {};
    let dayChanged = false;
    for (const [dayKey, count] of Object.entries(bucket.days)) {
      if (dayKey >= cutoff) days[dayKey] = count;
      else dayChanged = true;
    }
    sites[hostname] = dayChanged ? { ...bucket, days } : bucket;
    if (dayChanged) changed = true;
  }

  const entries = Object.entries(sites);
  if (entries.length > SITE_STATS_LIMIT) {
    entries.sort((a, b) => b[1].total - a[1].total || b[1].lastSeen - a[1].lastSeen);
    return { ...state, sites: Object.fromEntries(entries.slice(0, SITE_STATS_LIMIT)) };
  }

  return changed ? { ...state, sites } : state;
}

/**
 * Kennzahlen für eine einzelne Website.
 * @param {SiteStatsState} state
 * @param {string|null} hostname
 * @param {Date} [at=new Date()]
 * @returns {{hostname: string|null, total: number, today: number, categories: Record<string, number>}}
 */
export function getSiteSummary(state, hostname, at = new Date()) {
  if (!hostname) return { hostname: null, total: 0, today: 0, categories: {} };
  const bucket = state.sites[hostname];
  if (!bucket) return { hostname, total: 0, today: 0, categories: {} };
  return {
    hostname,
    total: bucket.total,
    today: bucket.days[toDayKey(at)] ?? 0,
    categories: { ...bucket.categories },
  };
}

/**
 * Websites mit den meisten Treffern.
 * @param {SiteStatsState} state
 * @param {number} [limit=10]
 * @param {Date} [at=new Date()]
 * @returns {Array<{hostname: string, total: number, today: number}>}
 */
export function getTopSites(state, limit = 10, at = new Date()) {
  const todayKey = toDayKey(at);
  return Object.entries(state.sites)
    .map(([hostname, bucket]) => ({
      hostname,
      total: bucket.total,
      today: bucket.days[todayKey] ?? 0,
    }))
    .sort((a, b) => b.total - a.total || a.hostname.localeCompare(b.hostname))
    .slice(0, Math.max(0, limit));
}

/**
 * Löscht die Daten einer einzelnen Website.
 * @param {SiteStatsState} state
 * @param {string} hostname
 * @returns {SiteStatsState}
 */
export function removeSite(state, hostname) {
  if (!state.sites[hostname]) return state;
  const sites = { ...state.sites };
  delete sites[hostname];
  return { ...state, sites };
}
