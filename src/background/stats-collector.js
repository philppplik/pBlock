/**
 * Erfassung blockierter Requests.
 *
 * ## Warum das in v4 nicht funktionierte
 *
 * v4 setzte auf `chrome.declarativeNetRequest.onRuleMatchedDebug`. Dieses
 * Ereignis existiert ausschließlich für entpackt geladene Erweiterungen — in
 * einer aus dem Web Store installierten Version feuert es nie. Für praktisch
 * alle echten Nutzer stand der Zähler damit dauerhaft auf 0.
 *
 * Der eingebaute Rückfallpfad half nicht: Er rief `getMatchedRules()` in einem
 * `setInterval` auf. Beides ist im Service Worker falsch. `setInterval` überlebt
 * das Beenden des Service Workers nicht (Chrome beendet ihn nach ~30 Sekunden
 * Untätigkeit), und `getMatchedRules()` ohne `tabId` verlangt die Berechtigung
 * `declarativeNetRequestFeedback`, die im Manifest gar nicht deklariert war — der
 * Aufruf warf jedes Mal, gefangen von einem leeren `catch`.
 *
 * ## Wie es jetzt läuft
 *
 * Drei Quellen, die sich ergänzen:
 *
 * 1. `onRuleMatchedDebug`, falls verfügbar (Entwicklungsmodus) — exakt und sofort.
 * 2. `getMatchedRules({tabId})` für den aktiven Tab, getaktet über
 *    `chrome.alarms`. Das funktioniert mit `activeTab` in der veröffentlichten
 *    Version und übersteht das Beenden des Service Workers.
 * 3. Meldungen des Content-Scripts für kosmetisch entfernte Elemente. Die
 *    erfasst ohnehin keine Netzwerk-API.
 *
 * Alle drei laufen in denselben Puffer, der gebündelt geschrieben wird.
 */

import { categoryForRuleId, recordBlocks } from '../core/statistics.js';
import { recordSiteBlocks } from '../core/site-stats.js';
import { extractHostname } from '../core/domain.js';
import { toDayKey } from '../core/time.js';
import { describeError } from '../core/logger.js';
import {
  readSettings,
  readSiteStats,
  readStatistics,
  writeSiteStats,
  writeStatistics,
} from './storage.js';

/** Name des Alarms für die getaktete Abfrage. */
export const POLL_ALARM_NAME = 'pblock:stats-poll';

/** Wie oft der aktive Tab abgefragt wird. Minimum von `chrome.alarms` ist 1 Minute. */
const POLL_PERIOD_MINUTES = 1;

/** Wie lange Ereignisse gesammelt werden, bevor geschrieben wird. */
const FLUSH_DELAY_MS = 1_500;

/**
 * @typedef {object} PendingBlock
 * @property {string|null} domain
 * @property {string|null} category
 * @property {string} resourceType
 * @property {string|null} initiatorHost
 * @property {number} count
 */

/** @type {PendingBlock[]} */
let buffer = [];
/** @type {ReturnType<typeof setTimeout>|null} */
let flushTimer = null;
/** @type {Set<number>} */
const seenRuleMatchIds = new Set();

/**
 * Nimmt Treffer in den Puffer auf.
 * @param {PendingBlock} entry
 */
export function enqueueBlock(entry) {
  if (!Number.isFinite(entry.count) || entry.count <= 0) return;
  buffer.push(entry);
}

/**
 * Schreibt den Puffer in den Storage.
 *
 * Warum gebündelt: Auf einer werbelastigen Seite fallen leicht 50 Treffer
 * innerhalb einer Sekunde an. v4 schrieb für jeden einzelnen den kompletten
 * Statistik- und Per-Site-Baum neu — 100 Storage-Operationen für einen
 * Seitenaufruf.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {(summary: object) => void} [deps.onFlushed]
 * @returns {Promise<number>} Anzahl der verbuchten Treffer.
 */
export async function flushBuffer({ logger, onFlushed }) {
  if (buffer.length === 0) return 0;

  const pending = buffer;
  buffer = [];

  try {
    const now = new Date();
    let statistics = await readStatistics();
    let siteStats = await readSiteStats();
    let total = 0;

    for (const entry of pending) {
      statistics = recordBlocks(statistics, {
        domain: entry.domain,
        category: entry.category,
        resourceType: entry.resourceType,
        count: entry.count,
        at: now,
      });
      if (entry.initiatorHost) {
        siteStats = recordSiteBlocks(siteStats, {
          hostname: entry.initiatorHost,
          category: entry.category,
          count: entry.count,
          at: now,
        });
      }
      total += entry.count;
    }

    await writeStatistics(statistics);
    await writeSiteStats(siteStats);
    await updateBadge(statistics, now);

    onFlushed?.(statistics);
    logger.debug(`${total} Treffer verbucht (${pending.length} Ereignisse)`);
    return total;
  } catch (error) {
    // Puffer zurücklegen, damit nichts verloren geht — aber begrenzt, sonst
    // wächst er bei dauerhaftem Storage-Fehler unbegrenzt.
    buffer = [...pending.slice(-200), ...buffer];
    logger.error('Statistik konnte nicht geschrieben werden', error);
    return 0;
  }
}

/**
 * Plant ein Schreiben des Puffers ein.
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {(summary: object) => void} [deps.onFlushed]
 */
export function scheduleFlush({ logger, onFlushed }) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushBuffer({ logger, onFlushed }).catch((error) =>
      logger.error('Puffer-Schreibvorgang fehlgeschlagen', error)
    );
  }, FLUSH_DELAY_MS);
}

/**
 * Aktualisiert die Zahl am Symbol.
 * @param {import('../core/statistics.js').StatisticsState} statistics
 * @param {Date} [now=new Date()]
 * @returns {Promise<void>}
 */
export async function updateBadge(statistics, now = new Date()) {
  try {
    const settings = await readSettings();
    if (!settings.ui.showBadge || !settings.masterEnabled) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }

    const today = statistics.days[toDayKey(now)]?.total ?? 0;
    // Chrome kürzt die Zahl am Symbol nach wenigen Zeichen ab. Lieber selbst
    // kürzen als eine abgeschnittene, irreführende Zahl anzeigen.
    let text = '';
    if (today > 9_999) text = '9999+';
    else if (today > 0) text = String(today);

    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: '#E5484D' });
  } catch {
    // Ein fehlgeschlagenes Badge-Update ist kosmetisch und darf nichts blockieren.
  }
}

/**
 * Registriert `onRuleMatchedDebug`, falls verfügbar.
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {(summary: object) => void} [deps.onFlushed]
 * @returns {boolean} Ob das Ereignis verfügbar war.
 */
export function registerDebugListener({ logger, onFlushed }) {
  const event = chrome.declarativeNetRequest?.onRuleMatchedDebug;
  if (!event?.addListener) return false;

  event.addListener((info) => {
    enqueueBlock({
      domain: extractHostname(info.request?.url),
      category: categoryForRuleId(info.rule?.ruleId),
      resourceType: info.request?.type ?? 'other',
      initiatorHost: extractHostname(info.request?.initiator) ?? null,
      count: 1,
    });
    scheduleFlush({ logger, onFlushed });
  });

  logger.info('Trefferzählung über onRuleMatchedDebug aktiv (Entwicklungsmodus)');
  return true;
}

/**
 * Fragt die Treffer des aktiven Tabs ab.
 *
 * `getMatchedRules` liefert nur Treffer der letzten Minuten und nur, solange die
 * Erweiterung Zugriff auf den Tab hat. Bereits gesehene Treffer werden über ihren
 * Zeitstempel ausgefiltert, damit nicht doppelt gezählt wird.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {(summary: object) => void} [deps.onFlushed]
 * @returns {Promise<number>} Anzahl neu erfasster Treffer.
 */
export async function pollActiveTab({ logger, onFlushed }) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || tab.id < 0) return 0;

    const response = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
    const matches = response?.rulesMatchedInfo ?? [];
    if (matches.length === 0) return 0;

    const initiatorHost = extractHostname(tab.url);
    let counted = 0;

    for (const match of matches) {
      // `tabId` + Zeitstempel identifiziert einen Treffer eindeutig genug.
      const fingerprint = Math.round(match.timeStamp);
      if (seenRuleMatchIds.has(fingerprint)) continue;
      seenRuleMatchIds.add(fingerprint);

      enqueueBlock({
        domain: null, // Die API nennt hier keine URL.
        category: categoryForRuleId(match.rule?.ruleId),
        resourceType: 'other',
        initiatorHost,
        count: 1,
      });
      counted += 1;
    }

    // Den Erinnerungsspeicher begrenzen, sonst wächst er über die Laufzeit des
    // Service Workers unbegrenzt.
    if (seenRuleMatchIds.size > 5_000) {
      const keep = [...seenRuleMatchIds].slice(-2_000);
      seenRuleMatchIds.clear();
      for (const value of keep) seenRuleMatchIds.add(value);
    }

    if (counted > 0) scheduleFlush({ logger, onFlushed });
    return counted;
  } catch (error) {
    // Häufigster Grund: kein Zugriff auf den Tab (chrome://, Web Store). Das ist
    // erwartbar und kein Fehler — deshalb nur auf Debug-Ebene.
    logger.debug('Abfrage des aktiven Tabs nicht möglich', describeError(error));
    return 0;
  }
}

/**
 * Richtet den Alarm für die getaktete Abfrage ein.
 *
 * Bewusst `chrome.alarms` statt `setInterval`: Ein Intervall verschwindet mit dem
 * Service Worker. Ein Alarm weckt ihn wieder auf.
 */
export function ensurePollAlarm() {
  chrome.alarms.create(POLL_ALARM_NAME, {
    periodInMinutes: POLL_PERIOD_MINUTES,
    delayInMinutes: POLL_PERIOD_MINUTES,
  });
}

/**
 * Anzahl der derzeit gepufferten Ereignisse — für die Diagnoseansicht.
 * @returns {number}
 */
export function getBufferSize() {
  return buffer.length;
}
