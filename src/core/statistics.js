/**
 * Statistik: reine Reduzierer über einen Zustandsbaum.
 *
 * ## Der entscheidende Umbau gegenüber v4
 *
 * v4 hielt `today`, `week` und `total` als drei unabhängige Zähler und musste bei
 * jedem einzelnen Treffer prüfen, ob inzwischen ein neuer Tag oder eine neue
 * Woche begonnen hat, um dann Zähler zurückzusetzen und ins Archiv zu schreiben.
 * Diese Logik existierte an drei Stellen (`recordBlock`, `getStatistics` und im
 * Cosmetic-Zweig des Service Workers) in drei leicht unterschiedlichen Varianten.
 * Eine davon las beim Tageswechsel die Stundendaten des *neuen* Tages und
 * archivierte sie unter dem *alten* Datum.
 *
 * Hier ist `days` die einzige Wahrheit. „Heute“ und „diese Woche“ werden bei
 * Bedarf berechnet. Damit gibt es keinen Rollover-Code mehr — und damit auch
 * keine Rollover-Fehler.
 */

import {
  AVG_RESOURCE_SIZES,
  HISTORY_RETENTION_DAYS,
  STATS_SCHEMA_VERSION,
  TOP_DOMAIN_LIMIT,
} from './constants.js';
import { dayLabel, fromDayKey, lastDayKeys, toDayKey, toWeekKey } from './time.js';

/**
 * @typedef {object} DayBucket
 * @property {number} total
 * @property {number[]} hours 24 Einträge, Index = Stunde.
 * @property {Record<string, number>} categories
 */

/**
 * @typedef {object} StatisticsState
 * @property {number} schemaVersion
 * @property {number} total Gesamtzahl seit Installation.
 * @property {number} bandwidthBytes Geschätzt eingespartes Volumen.
 * @property {Record<string, DayBucket>} days
 * @property {Record<string, number>} domains
 * @property {number} createdAt
 */

/**
 * Frischer Statistik-Zustand.
 * @param {number} [now=Date.now()]
 * @returns {StatisticsState}
 */
export function createEmptyStatistics(now = Date.now()) {
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    total: 0,
    bandwidthBytes: 0,
    days: {},
    domains: {},
    createdAt: now,
  };
}

/**
 * Repariert einen aus dem Storage gelesenen Zustand.
 *
 * Kaputte Statistik darf niemals dazu führen, dass die Erweiterung nicht mehr
 * blockiert — im Zweifel lieber Zahlen verlieren als Funktion.
 *
 * @param {unknown} stored
 * @param {number} [now=Date.now()]
 * @returns {StatisticsState}
 */
export function normalizeStatistics(stored, now = Date.now()) {
  const base = createEmptyStatistics(now);
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return base;

  if (Number.isFinite(stored.total) && stored.total >= 0) base.total = Math.floor(stored.total);
  if (Number.isFinite(stored.bandwidthBytes) && stored.bandwidthBytes >= 0) {
    base.bandwidthBytes = Math.floor(stored.bandwidthBytes);
  }
  if (Number.isFinite(stored.createdAt)) base.createdAt = stored.createdAt;

  base.days = normalizeDays(stored.days);
  base.domains = normalizeDomains(stored.domains);
  return base;
}

/**
 * Filtert die Tagesdaten auf gültige ISO-Schlüssel.
 * @param {unknown} stored
 * @returns {Record<string, DayBucket>}
 */
function normalizeDays(stored) {
  /** @type {Record<string, DayBucket>} */
  const days = {};
  if (typeof stored !== 'object' || stored === null) return days;

  for (const [dayKey, bucket] of Object.entries(stored)) {
    // v4 nutzte `toDateString()` ("Fri Sep 11 2026") als Schlüssel. Solche
    // Einträge lassen sich nicht sinnvoll umrechnen und fallen hier weg.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
    days[dayKey] = normalizeDayBucket(bucket);
  }
  return days;
}

/**
 * Filtert die Domain-Zähler auf positive Ganzzahlen.
 * @param {unknown} stored
 * @returns {Record<string, number>}
 */
function normalizeDomains(stored) {
  /** @type {Record<string, number>} */
  const domains = {};
  if (typeof stored !== 'object' || stored === null) return domains;

  for (const [domain, count] of Object.entries(stored)) {
    if (typeof domain === 'string' && Number.isFinite(count) && count > 0) {
      domains[domain] = Math.floor(count);
    }
  }
  return domains;
}

/**
 * @param {unknown} bucket
 * @returns {DayBucket}
 */
function normalizeDayBucket(bucket) {
  /** @type {DayBucket} */
  const clean = { total: 0, hours: new Array(24).fill(0), categories: {} };
  if (typeof bucket !== 'object' || bucket === null) return clean;

  if (Number.isFinite(bucket.total) && bucket.total >= 0) clean.total = Math.floor(bucket.total);
  if (Array.isArray(bucket.hours)) {
    for (let hour = 0; hour < 24; hour += 1) {
      const value = bucket.hours[hour];
      clean.hours[hour] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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
 * Verbucht blockierte Requests.
 *
 * Akzeptiert bewusst eine Anzahl statt nur eines einzelnen Treffers: Content-Scripts
 * melden gebündelt, und ein einzelnes Storage-Schreiben für 40 versteckte Elemente
 * ist deutlich billiger als 40 einzelne.
 *
 * @param {StatisticsState} state
 * @param {object} event
 * @param {string|null} [event.domain] Die blockierte Domain.
 * @param {string|null} [event.category] Kategorie-ID.
 * @param {string} [event.resourceType='other']
 * @param {number} [event.count=1]
 * @param {Date} [event.at=new Date()]
 * @returns {StatisticsState} Neuer Zustand; das Original bleibt unverändert.
 */
export function recordBlocks(state, event = {}) {
  const {
    domain = null,
    category = null,
    resourceType = 'other',
    count = 1,
    at = new Date(),
  } = event;
  if (!Number.isFinite(count) || count <= 0) return state;

  const amount = Math.floor(count);
  const dayKey = toDayKey(at);
  const hour = at.getHours();

  const next = {
    ...state,
    days: { ...state.days },
    domains: { ...state.domains },
  };

  const previous = next.days[dayKey] ?? { total: 0, hours: new Array(24).fill(0), categories: {} };
  const hours = [...previous.hours];
  hours[hour] += amount;

  const categories = { ...previous.categories };
  if (category) categories[category] = (categories[category] ?? 0) + amount;

  next.days[dayKey] = { total: previous.total + amount, hours, categories };
  next.total += amount;
  next.bandwidthBytes += (AVG_RESOURCE_SIZES[resourceType] ?? AVG_RESOURCE_SIZES.other) * amount;

  if (domain) next.domains[domain] = (next.domains[domain] ?? 0) + amount;

  return pruneStatistics(next, at);
}

/**
 * Entfernt alte Tage und selten getroffene Domains.
 *
 * Ohne das wächst der Storage unbegrenzt. v4 begrenzte zwar auf 30 Tage, löschte
 * die Stundendaten aber nach einem anderen Schlüssel als die Tagesdaten — die
 * Stundenhistorie wuchs also weiter.
 *
 * @param {StatisticsState} state
 * @param {Date} [now=new Date()]
 * @returns {StatisticsState}
 */
export function pruneStatistics(state, now = new Date()) {
  // Der Stichtag richtet sich nach dem **jüngsten vorhandenen Tag**, nicht nach
  // dem Zeitpunkt des auslösenden Ereignisses. Zwei Gründe:
  //
  //  - Ereignisse treffen nicht zwingend in zeitlicher Reihenfolge ein
  //    (verzögerte Meldung eines Content-Scripts, Uhrumstellung, Systemuhr
  //    springt). Ein Stichtag aus einem alten Ereignis würde dann entweder
  //    neuere Tage löschen oder gar nicht mehr aufräumen.
  //  - So bleibt das Ergebnis unabhängig davon, wann aufgeräumt wird.
  //
  // ISO-Tagesschlüssel sortieren lexikografisch korrekt, ein String-Vergleich reicht.
  const dayKeys = Object.keys(state.days);
  const newestKnown =
    dayKeys.length > 0 ? dayKeys.reduce((a, b) => (a > b ? a : b)) : toDayKey(now);
  const reference = newestKnown > toDayKey(now) ? (fromDayKey(newestKnown) ?? now) : now;
  const [cutoff] = lastDayKeys(HISTORY_RETENTION_DAYS, reference);
  let changed = false;

  /** @type {Record<string, DayBucket>} */
  const days = {};
  for (const [dayKey, bucket] of Object.entries(state.days)) {
    if (dayKey >= cutoff) days[dayKey] = bucket;
    else changed = true;
  }

  let domains = state.domains;
  const domainEntries = Object.entries(state.domains);
  if (domainEntries.length > TOP_DOMAIN_LIMIT) {
    domainEntries.sort((a, b) => b[1] - a[1]);
    domains = Object.fromEntries(domainEntries.slice(0, TOP_DOMAIN_LIMIT));
    changed = true;
  }

  return changed ? { ...state, days, domains } : state;
}

/**
 * Summe der Treffer eines Tages.
 * @param {StatisticsState} state
 * @param {Date} [at=new Date()]
 * @returns {number}
 */
export function getTodayTotal(state, at = new Date()) {
  return state.days[toDayKey(at)]?.total ?? 0;
}

/**
 * Summe der Treffer der laufenden ISO-Woche.
 *
 * Wird aus den Tagesdaten berechnet statt aus einem eigenen Zähler — dadurch
 * stimmt der Wert auch dann, wenn der Browser über einen Wochenwechsel hinweg
 * geschlossen war. v4 setzte den Wochenzähler in diesem Fall auf 0.
 *
 * @param {StatisticsState} state
 * @param {Date} [at=new Date()]
 * @returns {number}
 */
export function getWeekTotal(state, at = new Date()) {
  const currentWeek = toWeekKey(at);
  let sum = 0;
  // 8 Tage rückwärts decken jede ISO-Woche vollständig ab.
  for (const dayKey of lastDayKeys(8, at)) {
    const [y, m, d] = dayKey.split('-').map(Number);
    if (toWeekKey(new Date(y, m - 1, d)) === currentWeek) {
      sum += state.days[dayKey]?.total ?? 0;
    }
  }
  return sum;
}

/**
 * Verlauf der letzten Tage für das Balkendiagramm.
 * @param {StatisticsState} state
 * @param {number} [days=7]
 * @param {Date} [at=new Date()]
 * @returns {Array<{date: string, label: string, count: number}>}
 */
export function getHistory(state, days = 7, at = new Date()) {
  return lastDayKeys(days, at).map((dayKey) => ({
    date: dayKey,
    label: dayLabel(dayKey, at),
    count: state.days[dayKey]?.total ?? 0,
  }));
}

/**
 * Stundenverteilung des heutigen Tages.
 * @param {StatisticsState} state
 * @param {Date} [at=new Date()]
 * @returns {number[]} 24 Werte.
 */
export function getTodayHourly(state, at = new Date()) {
  const bucket = state.days[toDayKey(at)];
  return bucket ? [...bucket.hours] : new Array(24).fill(0);
}

/**
 * Stunde mit den meisten Treffern am heutigen Tag.
 * @param {StatisticsState} state
 * @param {Date} [at=new Date()]
 * @returns {{hour: number, count: number}} `hour` ist `-1`, wenn es noch keine Daten gibt.
 */
export function getPeakHour(state, at = new Date()) {
  const hours = getTodayHourly(state, at);
  let peak = { hour: -1, count: 0 };
  for (let hour = 0; hour < hours.length; hour += 1) {
    if (hours[hour] > peak.count) peak = { hour, count: hours[hour] };
  }
  return peak;
}

/**
 * Häufigste blockierte Domains.
 * @param {StatisticsState} state
 * @param {number} [limit=10]
 * @returns {Array<{domain: string, count: number}>}
 */
export function getTopDomains(state, limit = 10) {
  return Object.entries(state.domains)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([domain, count]) => ({ domain, count }));
}

/**
 * Verteilung nach Kategorie über einen Zeitraum.
 * @param {StatisticsState} state
 * @param {number} [days=7]
 * @param {Date} [at=new Date()]
 * @returns {Array<{category: string, count: number, percentage: number}>}
 */
export function getCategoryBreakdown(state, days = 7, at = new Date()) {
  /** @type {Record<string, number>} */
  const totals = {};
  for (const dayKey of lastDayKeys(days, at)) {
    const bucket = state.days[dayKey];
    if (!bucket) continue;
    for (const [category, count] of Object.entries(bucket.categories)) {
      totals[category] = (totals[category] ?? 0) + count;
    }
  }

  const sum = Object.values(totals).reduce((acc, value) => acc + value, 0);
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      percentage: sum > 0 ? Math.round((count / sum) * 100) : 0,
    }));
}

/**
 * Stellt die Kennzahlen zusammen, die Popup und Optionen anzeigen.
 * @param {StatisticsState} state
 * @param {Date} [at=new Date()]
 * @returns {{
 *   today: number, week: number, total: number,
 *   bandwidthBytes: number, bandwidthFormatted: string,
 *   peakHour: {hour: number, count: number},
 *   categories: Array<{category: string, count: number, percentage: number}>
 * }}
 */
export function summarize(state, at = new Date()) {
  return {
    today: getTodayTotal(state, at),
    week: getWeekTotal(state, at),
    total: state.total,
    bandwidthBytes: state.bandwidthBytes,
    bandwidthFormatted: formatBytes(state.bandwidthBytes),
    peakHour: getPeakHour(state, at),
    categories: getCategoryBreakdown(state, 7, at),
  };
}

/**
 * Formatiert Bytes mit deutscher Dezimaltrennung.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = [
    { limit: 1024 ** 3, suffix: 'GB', digits: 2 },
    { limit: 1024 ** 2, suffix: 'MB', digits: 1 },
    { limit: 1024, suffix: 'KB', digits: 1 },
  ];
  for (const unit of units) {
    if (bytes >= unit.limit) {
      return `${(bytes / unit.limit).toFixed(unit.digits).replace('.', ',')} ${unit.suffix}`;
    }
  }
  return `${Math.round(bytes)} B`;
}

/**
 * Formatiert eine Trefferzahl kompakt (z. B. `12,4 Tsd.`).
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} Mio.`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace('.', ',')} Tsd.`;
  return value.toLocaleString('de-DE');
}

/**
 * Ordnet eine Regel-ID einer Kategorie zu.
 *
 * Die Bereiche spiegeln {@link import('./constants.js').RULE_ID_RANGES}.
 *
 * @param {number|undefined} ruleId
 * @returns {string|null}
 */
export function categoryForRuleId(ruleId) {
  if (!Number.isFinite(ruleId)) return null;
  if (ruleId < 1_000) return null; // Allow-Regeln blockieren nichts.
  if (ruleId < 10_000) return 'custom';
  if (ruleId < 20_000) return 'category';
  return 'presets';
}
