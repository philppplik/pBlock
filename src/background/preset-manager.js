/**
 * Herunterladen und Übersetzen der zuschaltbaren Filterlisten.
 *
 * ## Sicherheitshinweis für die Store-Prüfung
 *
 * Hier werden ausschließlich **Daten** geladen, niemals Code. Der heruntergeladene
 * Text durchläuft `parseFilterList` und wird zu declarativeNetRequest-Regeln.
 * Nichts davon wird ausgeführt. Die Quell-URLs sind fest im Paket hinterlegt und
 * werden zusätzlich gegen {@link isAllowedPresetUrl} geprüft.
 *
 * ## Robustheit
 *
 * v4 hatte hier keinerlei Zeitbegrenzung und keine Größenbeschränkung. Ein
 * hängender Server hielt den Aufruf offen, bis Chrome den Service Worker beendete —
 * die Liste blieb dann dauerhaft im Zustand „wird geladen“. Jetzt gilt ein
 * Zeitlimit, eine Größengrenze, und jeder Fehlschlag wird an der Liste vermerkt,
 * sodass die Oberfläche ihn anzeigen kann.
 */

import { PRESETS, isAllowedPresetUrl, normalizePresetMeta } from '../core/presets.js';
import { buildRulesFromParsedList, parseFilterList } from '../core/filter-parser.js';
import { describeError } from '../core/logger.js';
import { readPresetMeta, removePresetRules, writePresetMeta, writePresetRules } from './storage.js';

/** Name des Alarms für die regelmäßige Aktualisierung. */
export const UPDATE_ALARM_NAME = 'pblock:preset-update';

/** Wie oft geprüft wird, ob eine Liste veraltet ist (in Minuten). */
const UPDATE_PERIOD_MINUTES = 6 * 60;

/** Abbruch, wenn der Server nicht antwortet. */
const FETCH_TIMEOUT_MS = 30_000;

/** Obergrenze für eine heruntergeladene Liste. EasyList liegt bei etwa 3 MB. */
const MAX_LIST_BYTES = 12 * 1024 * 1024;

/**
 * Lädt eine Filterliste herunter.
 * @param {string} url
 * @returns {Promise<string>}
 * @throws {Error} Bei Zeitüberschreitung, HTTP-Fehler oder Überschreitung der Größengrenze.
 */
async function fetchListText(url) {
  if (!isAllowedPresetUrl(url)) {
    throw new Error('Die Quelle ist keine zulässige HTTPS-Adresse.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      // Keine Cookies, keine Anmeldedaten — wir holen eine öffentliche Textdatei.
      credentials: 'omit',
      cache: 'no-cache',
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Server antwortete mit HTTP ${response.status}.`);
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_LIST_BYTES) {
      throw new Error('Die Liste ist größer als erlaubt.');
    }

    const text = await response.text();
    if (text.length > MAX_LIST_BYTES) {
      throw new Error('Die Liste ist größer als erlaubt.');
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Zeitüberschreitung beim Herunterladen.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Lädt eine Liste, übersetzt sie und speichert das Ergebnis.
 *
 * @param {string} presetId
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @returns {Promise<{ok: boolean, ruleCount: number, sourceEntries: number, error: string|null, skippedReasons: Record<string, number>}>}
 */
export async function updatePreset(presetId, { logger }) {
  const definition = PRESETS[presetId];
  const log = logger.child('Filterlisten');

  if (!definition) {
    return {
      ok: false,
      ruleCount: 0,
      sourceEntries: 0,
      error: 'Unbekannte Liste.',
      skippedReasons: {},
    };
  }

  try {
    log.info(`Lade ${definition.name} …`);
    const text = await fetchListText(definition.url);
    const parsed = parseFilterList(text);
    const rules = buildRulesFromParsedList(parsed);

    await writePresetRules(presetId, rules);

    const meta = await readPresetMeta();
    meta[presetId] = {
      ...meta[presetId],
      ruleCount: rules.length,
      sourceEntries: parsed.stats.accepted,
      updatedAt: Date.now(),
      lastError: null,
    };
    await writePresetMeta(meta);

    log.info(
      `${definition.name}: ${parsed.stats.accepted} Einträge übernommen, ${parsed.stats.skipped} verworfen, ${rules.length} Regeln erzeugt`,
      parsed.stats.reasons
    );

    return {
      ok: true,
      ruleCount: rules.length,
      sourceEntries: parsed.stats.accepted,
      error: null,
      skippedReasons: parsed.stats.reasons,
    };
  } catch (error) {
    const message = describeError(error);
    log.error(`${definition.name} konnte nicht aktualisiert werden: ${message}`);

    // Fehler an der Liste vermerken, damit die Oberfläche ihn zeigen kann statt
    // stumm eine veraltete Regelzahl anzuzeigen.
    try {
      const meta = await readPresetMeta();
      meta[presetId] = { ...meta[presetId], lastError: message };
      await writePresetMeta(meta);
    } catch {
      // Wenn schon das Vermerken scheitert, bringt weiteres Nachfassen nichts.
    }

    return { ok: false, ruleCount: 0, sourceEntries: 0, error: message, skippedReasons: {} };
  }
}

/**
 * Schaltet eine Liste ein oder aus.
 *
 * Beim Einschalten wird sofort heruntergeladen, falls noch keine Daten vorliegen.
 * Beim Ausschalten werden die gespeicherten Regeln gelöscht — sie belegen sonst
 * dauerhaft mehrere Megabyte im Storage, ohne irgendeine Wirkung zu haben.
 *
 * @param {string} presetId
 * @param {boolean} enabled
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export async function togglePreset(presetId, enabled, { logger }) {
  if (!PRESETS[presetId]) return { ok: false, error: 'Unbekannte Liste.' };

  const meta = await readPresetMeta();
  meta[presetId] = { ...meta[presetId], enabled };
  await writePresetMeta(meta);

  if (!enabled) {
    await removePresetRules(presetId);
    const cleared = await readPresetMeta();
    cleared[presetId] = { ...cleared[presetId], ruleCount: 0, updatedAt: null };
    await writePresetMeta(cleared);
    return { ok: true, error: null };
  }

  if (meta[presetId].updatedAt === null) {
    const result = await updatePreset(presetId, { logger });
    return { ok: result.ok, error: result.error };
  }

  return { ok: true, error: null };
}

/**
 * Aktualisiert alle aktiven Listen, deren Daten veraltet sind.
 *
 * Bewusst nacheinander statt parallel: Fünf gleichzeitige Downloads von je
 * mehreren Megabyte, die anschließend alle geparst werden, lasten den Service
 * Worker unnötig aus und riskieren, dass Chrome ihn beendet.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {boolean} [deps.force=false] Auch frische Listen neu laden.
 * @returns {Promise<{updated: string[], failed: string[]}>}
 */
export async function updateStalePresets({ logger, force = false }) {
  const { getStalePresetIds } = await import('../core/presets.js');
  const meta = normalizePresetMeta(await readPresetMeta());

  const ids = force
    ? Object.entries(meta)
        .filter(([, entry]) => entry.enabled)
        .map(([id]) => id)
    : getStalePresetIds(meta);

  /** @type {string[]} */
  const updated = [];
  /** @type {string[]} */
  const failed = [];

  for (const id of ids) {
    // Bewusst sequenziell — Begründung siehe Funktionskommentar.
    const result = await updatePreset(id, { logger });
    if (result.ok) updated.push(id);
    else failed.push(id);
  }

  return { updated, failed };
}

/**
 * Richtet den Alarm für die regelmäßige Aktualisierung ein.
 */
export function ensureUpdateAlarm() {
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    periodInMinutes: UPDATE_PERIOD_MINUTES,
    // Nicht sofort beim Start loslegen: Direkt nach dem Browserstart ist die
    // Bandbreite für die Seiten des Nutzers besser aufgehoben.
    delayInMinutes: 5,
  });
}
