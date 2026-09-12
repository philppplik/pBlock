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
 * ## Was v5.1.0 hier geändert hat
 *
 * In v5.0.0 schlugen bei einem Nutzer alle fünf Listen mit „Failed to fetch“
 * fehl — innerhalb von vier Millisekunden. So schnell scheitert kein
 * Netzwerkzugriff. Die Ursache lag nicht im Netz, sondern in einer aus EasyList
 * Germany erzeugten Regel, die jede HTTPS-Anfrage blockierte (Einzelheiten in
 * `filter-parser.js`). Drei Konsequenzen:
 *
 * 1. **Mehrere Quellen je Liste**, der Reihe nach versucht. Idee von uBlock
 *    Origin übernommen, siehe `presets.js`.
 * 2. **Wiederholversuche** mit wachsendem Abstand bei vorübergehenden Fehlern.
 * 3. **Kanarienvogel-Prüfung**: Regeln, die eine Adresse treffen würden, die
 *    erreichbar bleiben muss, werden verworfen — nicht angewendet.
 */

import {
  PRESETS,
  PRESET_SOURCE_URLS,
  isAllowedPresetUrl,
  normalizePresetMeta,
} from '../core/presets.js';
import {
  buildRulesFromParsedList,
  findSelfBlockingRules,
  parseFilterList,
} from '../core/filter-parser.js';
import { describeError } from '../core/logger.js';
import { readPresetMeta, removePresetRules, writePresetMeta, writePresetRules } from './storage.js';

/** Name des Alarms für die regelmäßige Aktualisierung. */
export const UPDATE_ALARM_NAME = 'pblock:preset-update';

/** Wie oft geprüft wird, ob eine Liste veraltet ist (in Minuten). */
const UPDATE_PERIOD_MINUTES = 6 * 60;

/** Abbruch, wenn der Server nicht antwortet. */
const FETCH_TIMEOUT_MS = 30_000;

/** Obergrenze für eine heruntergeladene Liste. EasyList liegt bei etwa 2 MB. */
const MAX_LIST_BYTES = 12 * 1024 * 1024;

/** Versuche je Quelle, bevor zur nächsten gewechselt wird. */
const ATTEMPTS_PER_SOURCE = 2;

/**
 * Adressen, die unter keinen Umständen blockiert werden dürfen.
 *
 * Neben den eigenen Bezugsquellen stehen hier einige der meistbesuchten
 * Adressen des Webs. Trifft eine erzeugte Regel eine davon, ist sie mit
 * Sicherheit zu breit geraten — kein Listenbetreuer würde google.com oder
 * wikipedia.org vollständig blockieren.
 *
 * @type {readonly string[]}
 */
const CANARY_URLS = Object.freeze([
  ...PRESET_SOURCE_URLS,
  'https://www.google.com/',
  'https://chromewebstore.google.com/',
  'https://github.com/',
  'https://www.wikipedia.org/',
  'https://example.com/',
  'https://www.bild.de/',
  'https://www.spiegel.de/',
]);

/**
 * Wartet eine Weile.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Lädt eine Filterliste von einer einzelnen Adresse.
 * @param {string} url
 * @returns {Promise<string>}
 * @throws {Error} Bei Zeitüberschreitung, HTTP-Fehler oder Überschreitung der Größengrenze.
 */
async function fetchOnce(url) {
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

    if (!response.ok) throw new Error(`Server antwortete mit HTTP ${response.status}.`);

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_LIST_BYTES) {
      throw new Error('Die Liste ist größer als erlaubt.');
    }

    const text = await response.text();
    if (text.length > MAX_LIST_BYTES) throw new Error('Die Liste ist größer als erlaubt.');
    // Eine leere oder winzige Antwort ist fast immer eine Fehlerseite.
    if (text.length < 100) throw new Error('Die Antwort ist zu kurz für eine Filterliste.');

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
 * Versucht alle Quellen einer Liste der Reihe nach.
 *
 * @param {import('../core/presets.js').PresetDefinition} preset
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>['child']} log
 * @returns {Promise<{text: string, url: string}>}
 * @throws {Error} Wenn keine Quelle erreichbar war.
 */
async function fetchFromAnySource(preset, log) {
  /** @type {string[]} */
  const failures = [];

  for (const url of preset.urls) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_SOURCE; attempt += 1) {
      try {
        const text = await fetchOnce(url);
        if (failures.length > 0) {
          log.info(`${preset.name}: über Ersatzquelle geladen (${new URL(url).hostname})`);
        }
        return { text, url };
      } catch (error) {
        const message = describeError(error);
        failures.push(`${new URL(url).hostname}: ${message}`);

        // Ein HTTP-Fehler wiederholt sich; ein Netzwerkfehler womöglich nicht.
        const worthRetrying = !message.includes('HTTP') && attempt < ATTEMPTS_PER_SOURCE;
        if (worthRetrying) {
          log.debug(`${preset.name}: Versuch ${attempt} fehlgeschlagen, neuer Versuch …`);
          await delay(1_000 * attempt);
        } else {
          break;
        }
      }
    }
  }

  throw new Error(`Keine Quelle erreichbar. ${failures.join(' · ')}`);
}

/**
 * Entfernt Regeln, die eine unverzichtbare Adresse blockieren würden.
 *
 * @param {Array<object>} rules
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>['child']} log
 * @param {string} presetName
 * @returns {{rules: Array<object>, removed: number}}
 */
function dropSelfBlockingRules(rules, log, presetName) {
  const offenders = findSelfBlockingRules(rules, CANARY_URLS);
  if (offenders.length === 0) return { rules, removed: 0 };

  const blockedIndexes = new Set(offenders.map((entry) => entry.index));

  // Laut protokollieren: Wenn das hier anschlägt, ist entweder die Liste kaputt
  // oder unser Parser hat einen Fehler. Beides muss sichtbar sein.
  log.error(
    `${presetName}: ${blockedIndexes.size} Regel(n) verworfen, die unverzichtbare Adressen blockiert hätten`,
    offenders.slice(0, 5).map((entry) => ({ url: entry.url, condition: entry.condition }))
  );

  return {
    rules: rules.filter((_rule, index) => !blockedIndexes.has(index)),
    removed: blockedIndexes.size,
  };
}

/**
 * Lädt eine Liste, übersetzt sie und speichert das Ergebnis.
 *
 * @param {string} presetId
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @returns {Promise<{ok: boolean, ruleCount: number, sourceEntries: number, error: string|null, skippedReasons: Record<string, number>, droppedUnsafe: number}>}
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
      droppedUnsafe: 0,
    };
  }

  try {
    log.info(`Lade ${definition.name} …`);
    const { text, url } = await fetchFromAnySource(definition, log);

    const parsed = parseFilterList(text);
    const built = buildRulesFromParsedList(parsed);
    const { rules, removed } = dropSelfBlockingRules(built, log, definition.name);

    await writePresetRules(presetId, rules);

    const meta = await readPresetMeta();
    meta[presetId] = {
      ...meta[presetId],
      ruleCount: rules.length,
      sourceEntries: parsed.stats.accepted,
      updatedAt: Date.now(),
      lastError: null,
      sourceUrl: url,
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
      droppedUnsafe: removed,
    };
  } catch (error) {
    const message = describeError(error);
    log.error(`${definition.name} konnte nicht aktualisiert werden: ${message}`);

    try {
      const meta = await readPresetMeta();
      meta[presetId] = { ...meta[presetId], lastError: message };
      await writePresetMeta(meta);
    } catch {
      // Wenn schon das Vermerken scheitert, bringt weiteres Nachfassen nichts.
    }

    return {
      ok: false,
      ruleCount: 0,
      sourceEntries: 0,
      error: message,
      skippedReasons: {},
      droppedUnsafe: 0,
    };
  }
}

/**
 * Schaltet eine Liste ein oder aus.
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
    cleared[presetId] = { ...cleared[presetId], ruleCount: 0, updatedAt: null, lastError: null };
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
