/**
 * Überträgt die Einstellungen in die declarativeNetRequest-Regeln des Browsers.
 *
 * ## Was hier anders läuft als in v4
 *
 * 1. **Entprellt.** v4 rief `applyRules()` synchron bei jedem Schalter auf. Wer
 *    in den Optionen fünf Häkchen hintereinander setzte, löste fünf komplette
 *    Regel-Neuschreibungen aus. Hier sammelt ein kurzes Zeitfenster die
 *    Änderungen ein.
 * 2. **Differenziell.** v4 löschte immer erst *alle* dynamischen Regeln und
 *    schrieb sie danach neu. Zwischen beiden API-Aufrufen lag ein Zeitfenster
 *    ganz ohne Schutz. Jetzt wird nur der tatsächliche Unterschied geschrieben;
 *    ändert sich nichts, passiert gar nichts.
 * 3. **Fehler werden gemeldet.** v4 fing jeden Fehler mit `catch` ab und gab `0`
 *    zurück. Wenn Chrome eine Regel ablehnte, blockierte die Erweiterung ab
 *    diesem Moment nichts mehr — sichtbar war das nirgends. Jetzt landet der
 *    Fehler im Protokoll und im Diagnosebericht.
 */

import { DYNAMIC_RULE_SAFE_LIMIT } from '../core/constants.js';
import { buildDynamicRuleSet, computeRuleUpdate } from '../core/rule-engine.js';
import { describeError } from '../core/logger.js';
import { readPresetMeta, readPresetRules, readSettings } from './storage.js';

/** Wartezeit, in der mehrere Änderungen zusammengefasst werden. */
const DEBOUNCE_MS = 150;

/** @type {ReturnType<typeof setTimeout>|null} */
let pendingTimer = null;
/** @type {Promise<ApplyResult>|null} */
let inFlight = null;

/**
 * @typedef {object} ApplyResult
 * @property {boolean} ok
 * @property {number} ruleCount
 * @property {{allow: number, custom: number, category: number, preset: number, total: number}} counts
 * @property {number} truncatedPresetRules
 * @property {boolean} unchanged
 * @property {string|null} error
 * @property {number} durationMs
 */

/**
 * Ermittelt das tatsächliche Regel-Limit des Browsers.
 *
 * Chrome garantiert 5.000; neuere Versionen erlauben deutlich mehr. Den Wert zur
 * Laufzeit zu lesen bedeutet: Auf aktuellen Browsern nutzen wir den größeren
 * Spielraum, auf älteren bleiben wir sicher darunter.
 *
 * @returns {number}
 */
export function getDynamicRuleLimit() {
  const reported = chrome.declarativeNetRequest?.MAX_NUMBER_OF_DYNAMIC_RULES;
  if (!Number.isFinite(reported) || reported <= 0) return DYNAMIC_RULE_SAFE_LIMIT;
  // Etwas Luft lassen: Andere Teile der Erweiterung könnten später ebenfalls
  // dynamische Regeln brauchen.
  return Math.max(DYNAMIC_RULE_SAFE_LIMIT, reported - 100);
}

/**
 * Sammelt die Regeln aller aktiven Filterlisten.
 * @param {import('../core/logger.js').createLogger extends () => infer L ? L : any} logger
 * @returns {Promise<Array<object>>}
 */
async function collectPresetRules(logger) {
  const meta = await readPresetMeta();
  const activeIds = Object.entries(meta)
    .filter(([, entry]) => entry.enabled)
    .map(([id]) => id);

  if (activeIds.length === 0) return [];

  const perList = await Promise.all(activeIds.map((id) => readPresetRules(id)));
  const rules = perList.flat();
  logger.debug(`${rules.length} Regeln aus ${activeIds.length} Filterliste(n) geladen`);
  return rules;
}

/**
 * Wendet die Regeln sofort an.
 *
 * Normalerweise ruft man {@link scheduleApply} auf. Diese Funktion ist für
 * Situationen gedacht, in denen das Ergebnis unmittelbar gebraucht wird —
 * Installation, Browserstart, Diagnose-Selbsttest.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @returns {Promise<ApplyResult>}
 */
export async function applyRulesNow({ logger }) {
  // Parallele Aufrufe zusammenführen: Zwei gleichzeitige `updateDynamicRules`
  // auf demselben Regelsatz können sich gegenseitig überholen.
  if (inFlight) return inFlight;

  inFlight = performApply({ logger }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * @param {{logger: ReturnType<typeof import('../core/logger.js').createLogger>}} deps
 * @returns {Promise<ApplyResult>}
 */
async function performApply({ logger }) {
  const startedAt = Date.now();
  const log = logger.child('Regeln');

  /** @type {ApplyResult} */
  const result = {
    ok: false,
    ruleCount: 0,
    counts: { allow: 0, custom: 0, category: 0, preset: 0, total: 0 },
    truncatedPresetRules: 0,
    unchanged: false,
    error: null,
    durationMs: 0,
  };

  try {
    const settings = await readSettings();
    const presetRules = settings.masterEnabled ? await collectPresetRules(log) : [];

    const built = buildDynamicRuleSet({
      settings,
      presetRules,
      maxRules: getDynamicRuleLimit(),
    });

    result.counts = built.counts;
    result.ruleCount = built.rules.length;
    result.truncatedPresetRules = built.truncatedPresetRules;

    if (built.truncatedPresetRules > 0) {
      log.warn(
        `${built.truncatedPresetRules} Regeln aus Filterlisten wurden wegen des Browser-Limits nicht übernommen`,
        { limit: getDynamicRuleLimit(), angewendet: built.counts.preset }
      );
    }

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const update = computeRuleUpdate(existing, built.rules);

    if (update.unchanged) {
      result.ok = true;
      result.unchanged = true;
      result.durationMs = Date.now() - startedAt;
      log.debug('Keine Änderung — Regeln bleiben unverändert');
      return result;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: update.removeRuleIds,
      addRules: update.addRules,
    });

    result.ok = true;
    result.durationMs = Date.now() - startedAt;
    log.info(
      `${built.rules.length} Regeln aktiv (${update.addRules.length} neu, ${update.removeRuleIds.length} entfernt)`,
      built.counts
    );
    return result;
  } catch (error) {
    result.error = describeError(error);
    result.durationMs = Date.now() - startedAt;
    // Das ist der Fall, in dem die Erweiterung faktisch aufhört zu schützen.
    // Er muss laut und nachvollziehbar sein.
    log.error('Regeln konnten nicht angewendet werden — es wird derzeit NICHT blockiert', error);
    return result;
  }
}

/**
 * Plant eine Anwendung der Regeln ein.
 *
 * Mehrere Aufrufe innerhalb des Zeitfensters lösen genau einen Durchlauf aus.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {(result: ApplyResult) => void} [deps.onApplied]
 */
export function scheduleApply({ logger, onApplied }) {
  if (pendingTimer) clearTimeout(pendingTimer);

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    applyRulesNow({ logger })
      .then((result) => onApplied?.(result))
      .catch((error) => logger.error('Geplante Regelanwendung fehlgeschlagen', error));
  }, DEBOUNCE_MS);
}

/**
 * Entfernt sämtliche dynamischen Regeln.
 *
 * Wird beim Zurücksetzen gebraucht, damit keine verwaisten Regeln zurückbleiben.
 *
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} logger
 * @returns {Promise<number>} Anzahl der entfernten Regeln.
 */
export async function clearAllDynamicRules(logger) {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length === 0) return 0;
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: [],
    });
    return existing.length;
  } catch (error) {
    logger.error('Dynamische Regeln konnten nicht entfernt werden', error);
    return 0;
  }
}
