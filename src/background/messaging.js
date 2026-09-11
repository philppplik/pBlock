/**
 * Vermittlung zwischen Oberfläche, Content-Scripts und Service Worker.
 *
 * ## Warum eine Tabelle statt eines `switch`
 *
 * v4 hatte hier einen einzelnen `switch` mit rund 40 Zweigen über 450 Zeilen.
 * Der unbekannte Fall antwortete mit `{error: 'Unknown message type'}`, was in
 * der Oberfläche nirgends geprüft wurde — ein Tippfehler im Nachrichtentyp
 * äußerte sich also als Feld, das einfach leer blieb.
 *
 * Hier ist jeder Handler eine eigene Funktion in einer Tabelle. Das Antwortformat
 * ist einheitlich `{ok: true, data}` bzw. `{ok: false, error}`, sodass die
 * Oberfläche einen Fehler nicht mit „keine Daten“ verwechseln kann.
 */

import { LIVE_PORT_NAME, MSG, fail, ok } from '../core/messages.js';
import {
  CATEGORY_TAXONOMY,
  PROTECTION_LEVEL_HINTS,
  PROTECTION_LEVEL_LABELS,
} from '../core/settings-schema.js';
import { getRegistryStats } from '../core/rule-registry.js';
import { describePresets } from '../core/presets.js';
import { extractHostname, findCoveringDomain, isHostnameWhitelisted } from '../core/domain.js';
import { getHistory, getTopDomains, summarize } from '../core/statistics.js';
import { getSiteSummary, getTopSites } from '../core/site-stats.js';
import { describeError } from '../core/logger.js';
import * as settingsApi from '../core/settings.js';
import * as store from './storage.js';
import { applyRulesNow, getDynamicRuleLimit, scheduleApply } from './rule-applier.js';
import { togglePreset, updatePreset, updateStalePresets } from './preset-manager.js';
import { enqueueBlock, getBufferSize, scheduleFlush } from './stats-collector.js';

/** Offene Verbindungen zu Popup-Instanzen für Live-Aktualisierungen. */
const livePorts = new Set();

/**
 * Schickt eine Nachricht an alle offenen Oberflächen.
 * @param {string} type
 * @param {unknown} payload
 */
export function broadcast(type, payload) {
  for (const port of [...livePorts]) {
    try {
      port.postMessage({ type, payload });
    } catch {
      // Die Gegenstelle ist weg — Port entfernen statt bei jedem Update erneut
      // zu scheitern.
      livePorts.delete(port);
    }
  }
}

/**
 * Registriert den Port-Listener für Live-Aktualisierungen.
 */
export function registerLivePort() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== LIVE_PORT_NAME) return;
    livePorts.add(port);
    port.onDisconnect.addListener(() => livePorts.delete(port));
  });
}

/**
 * Ermittelt Host und Whitelist-Status des aktiven Tabs.
 * @param {import('../core/settings.js').Settings} settings
 * @returns {Promise<{hostname: string|null, url: string|null, isWhitelisted: boolean, coveredBy: string|null}>}
 */
async function describeActiveTab(settings) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const hostname = extractHostname(tab?.url);
    return {
      hostname,
      url: tab?.url ?? null,
      isWhitelisted: hostname ? isHostnameWhitelisted(hostname, settings.whitelist) : false,
      coveredBy: hostname ? findCoveringDomain(hostname, settings.whitelist) : null,
    };
  } catch {
    return { hostname: null, url: null, isWhitelisted: false, coveredBy: null };
  }
}

/**
 * Baut die Handler-Tabelle.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @returns {Record<string, (message: any, sender: chrome.runtime.MessageSender) => Promise<object>>}
 */
export function createHandlers({ logger }) {
  /** Einstellungen schreiben, Regeln neu anwenden, Oberflächen informieren. */
  async function commit(settings) {
    await store.writeSettings(settings);
    scheduleApply({
      logger,
      onApplied: (result) => broadcast(MSG.PUSH_SETTINGS, { ruleCount: result.ruleCount }),
    });
    await notifyContentScripts(settings);
    return settings;
  }

  /**
   * Informiert alle offenen Tabs über geänderte Einstellungen, damit die
   * Cosmetic-Filter sofort greifen statt erst beim nächsten Laden.
   */
  async function notifyContentScripts(settings) {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.all(
        tabs
          .filter((tab) => typeof tab.id === 'number' && tab.url?.startsWith('http'))
          .map((tab) =>
            chrome.tabs
              .sendMessage(tab.id, {
                type: MSG.GET_CONTENT_CONFIG,
                payload: buildContentConfig(settings, extractHostname(tab.url)),
              })
              // Tabs ohne geladenes Content-Script antworten nicht. Das ist normal.
              .catch(() => {})
          )
      );
    } catch (error) {
      logger.debug('Tabs konnten nicht benachrichtigt werden', describeError(error));
    }
  }

  return {
    // ---- Zustand ----------------------------------------------------------
    async [MSG.GET_POPUP_STATE]() {
      const settings = await store.readSettings();
      const statistics = await store.readStatistics();
      const siteStats = await store.readSiteStats();
      const tab = await describeActiveTab(settings);

      return ok({
        settings,
        summary: summarize(statistics),
        site: getSiteSummary(siteStats, tab.hostname),
        tab,
        levelLabels: PROTECTION_LEVEL_LABELS,
        levelHints: PROTECTION_LEVEL_HINTS,
        taxonomy: CATEGORY_TAXONOMY,
        registryStats: getRegistryStats(),
      });
    },

    async [MSG.GET_OPTIONS_STATE]() {
      const settings = await store.readSettings();
      const statistics = await store.readStatistics();
      const siteStats = await store.readSiteStats();
      const presetMeta = await store.readPresetMeta();

      return ok({
        settings,
        summary: summarize(statistics),
        history: getHistory(statistics, 14),
        topDomains: getTopDomains(statistics, 15),
        topSites: getTopSites(siteStats, 15),
        presets: describePresets(presetMeta),
        taxonomy: CATEGORY_TAXONOMY,
        registryStats: getRegistryStats(),
        levelLabels: PROTECTION_LEVEL_LABELS,
        levelHints: PROTECTION_LEVEL_HINTS,
      });
    },

    async [MSG.GET_CONTENT_CONFIG](_message, sender) {
      const settings = await store.readSettings();
      const hostname = extractHostname(sender?.tab?.url ?? sender?.url);
      return ok(buildContentConfig(settings, hostname));
    },

    // ---- Schalter ---------------------------------------------------------
    async [MSG.SET_MASTER_ENABLED](message) {
      const settings = await store.readSettings();
      await commit({
        ...settingsApi.cloneSettings(settings),
        masterEnabled: Boolean(message.enabled),
      });
      return ok({ masterEnabled: Boolean(message.enabled) });
    },

    async [MSG.SET_UI_MODE](message) {
      if (message.mode !== 'simple' && message.mode !== 'expert') {
        return fail('Unbekannter Anzeigemodus.', 'INVALID_MODE');
      }
      const settings = await store.readSettings();
      // Der Anzeigemodus beeinflusst keine Regeln — hier reicht Speichern.
      await store.writeSettings({ ...settingsApi.cloneSettings(settings), uiMode: message.mode });
      return ok({ uiMode: message.mode });
    },

    async [MSG.SET_PROTECTION_LEVEL](message) {
      const settings = await store.readSettings();
      const next = settingsApi.applyProtectionLevel(settings, message.level);
      if (next === settings) return fail('Unbekannte Schutzstufe.', 'INVALID_LEVEL');
      await commit(next);
      return ok({ protectionLevel: next.protectionLevel, categories: next.categories });
    },

    async [MSG.SET_CATEGORY](message) {
      const settings = await store.readSettings();
      const next = settingsApi.setCategoryEnabled(settings, message.categoryId, message.enabled);
      if (next === settings) return fail('Unbekannte Kategorie.', 'UNKNOWN_CATEGORY');
      await commit(next);
      return ok({ categories: next.categories });
    },

    async [MSG.SET_SUBCATEGORY](message) {
      const settings = await store.readSettings();
      const next = settingsApi.setSubcategoryEnabled(
        settings,
        message.categoryId,
        message.subcategoryId,
        message.enabled
      );
      if (next === settings) return fail('Unbekannte Unterkategorie.', 'UNKNOWN_SUBCATEGORY');
      await commit(next);
      return ok({ categories: next.categories });
    },

    // ---- Whitelist --------------------------------------------------------
    async [MSG.WHITELIST_ADD](message) {
      const settings = await store.readSettings();
      const { settings: next, added } = settingsApi.addToWhitelist(settings, message.domain);
      if (!added) return fail('Die Adresse konnte nicht übernommen werden.', 'INVALID_DOMAIN');
      await commit(next);
      return ok({ added, whitelist: next.whitelist });
    },

    async [MSG.WHITELIST_REMOVE](message) {
      const settings = await store.readSettings();
      const next = settingsApi.removeFromWhitelist(settings, message.domain);
      if (next === settings) return fail('Eintrag nicht gefunden.', 'NOT_FOUND');
      await commit(next);
      return ok({ whitelist: next.whitelist });
    },

    async [MSG.WHITELIST_TOGGLE_ACTIVE_TAB]() {
      const settings = await store.readSettings();
      const tab = await describeActiveTab(settings);
      if (!tab.hostname) return fail('Für diese Seite ist das nicht möglich.', 'NO_HOST');

      // Abgedeckt heißt nicht zwingend „exakt eingetragen“: Ist `example.com`
      // freigegeben und der Nutzer steht auf `shop.example.com`, muss der
      // Schalter den tatsächlich wirksamen Eintrag entfernen.
      const next = tab.isWhitelisted
        ? settingsApi.removeFromWhitelist(settings, tab.coveredBy ?? tab.hostname)
        : settingsApi.addToWhitelist(settings, tab.hostname).settings;

      await commit(next);
      return ok({ whitelist: next.whitelist, isWhitelisted: !tab.isWhitelisted });
    },

    // ---- Eigene Regeln ----------------------------------------------------
    async [MSG.CUSTOM_RULE_ADD](message) {
      const settings = await store.readSettings();
      const { settings: next, added } = settingsApi.addCustomRule(settings, message.urlFilter);
      if (!added)
        return fail('Die Regel ist leer, zu lang oder bereits vorhanden.', 'INVALID_RULE');
      await commit(next);
      return ok({ customRules: next.customRules });
    },

    async [MSG.CUSTOM_RULE_REMOVE](message) {
      const settings = await store.readSettings();
      const next = settingsApi.removeCustomRule(settings, message.index);
      if (next === settings) return fail('Regel nicht gefunden.', 'NOT_FOUND');
      await commit(next);
      return ok({ customRules: next.customRules });
    },

    // ---- Element-Picker ---------------------------------------------------
    async [MSG.PICKER_ACTIVATE](_message, sender) {
      const tabId =
        sender?.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (typeof tabId !== 'number') return fail('Kein aktiver Tab gefunden.', 'NO_TAB');
      try {
        await chrome.tabs.sendMessage(tabId, { type: MSG.PICKER_ACTIVATE });
        return ok({ tabId });
      } catch {
        return fail(
          'Auf dieser Seite ist der Element-Picker nicht verfügbar.',
          'NO_CONTENT_SCRIPT'
        );
      }
    },

    async [MSG.ELEMENT_RULE_ADD](message, sender) {
      const settings = await store.readSettings();
      const domain = message.domain ?? extractHostname(sender?.tab?.url);
      const { settings: next, added } = settingsApi.addElementRule(settings, {
        selector: message.selector,
        domain,
        siteOnly: message.siteOnly === true,
      });
      if (!added)
        return fail('Der Selektor ist ungültig oder bereits vorhanden.', 'INVALID_SELECTOR');
      await commit(next);
      return ok({ rule: added, elementRules: next.elementRules });
    },

    async [MSG.ELEMENT_RULE_REMOVE](message) {
      const settings = await store.readSettings();
      const { settings: next, removed } = settingsApi.removeElementRule(settings, message.index);
      if (!removed) return fail('Regel nicht gefunden.', 'NOT_FOUND');
      await commit(next);
      return ok({ removed, elementRules: next.elementRules });
    },

    async [MSG.ELEMENT_RULE_UNDO]() {
      const settings = await store.readSettings();
      const { settings: next, removed } = settingsApi.undoLastElementRule(settings);
      if (!removed) return fail('Es gibt nichts rückgängig zu machen.', 'NOTHING_TO_UNDO');
      await commit(next);
      return ok({ removed, elementRules: next.elementRules });
    },

    async [MSG.ELEMENT_RULE_CLEAR]() {
      const settings = await store.readSettings();
      const next = settingsApi.clearElementRules(settings);
      await commit(next);
      return ok({ elementRules: next.elementRules });
    },

    // ---- Filterlisten -----------------------------------------------------
    async [MSG.PRESET_LIST]() {
      return ok({ presets: describePresets(await store.readPresetMeta()) });
    },

    async [MSG.PRESET_TOGGLE](message) {
      const result = await togglePreset(message.presetId, Boolean(message.enabled), { logger });
      if (!result.ok) return fail(result.error ?? 'Umschalten fehlgeschlagen.', 'PRESET_TOGGLE');
      const applied = await applyRulesNow({ logger });
      return ok({
        presets: describePresets(await store.readPresetMeta()),
        ruleCount: applied.ruleCount,
        truncated: applied.truncatedPresetRules,
      });
    },

    async [MSG.PRESET_UPDATE](message) {
      const result = await updatePreset(message.presetId, { logger });
      if (!result.ok)
        return fail(result.error ?? 'Aktualisierung fehlgeschlagen.', 'PRESET_UPDATE');
      const applied = await applyRulesNow({ logger });
      return ok({
        presets: describePresets(await store.readPresetMeta()),
        ruleCount: applied.ruleCount,
        truncated: applied.truncatedPresetRules,
        skippedReasons: result.skippedReasons,
      });
    },

    async [MSG.PRESET_UPDATE_ALL]() {
      const result = await updateStalePresets({ logger, force: true });
      await applyRulesNow({ logger });
      return ok({ ...result, presets: describePresets(await store.readPresetMeta()) });
    },

    // ---- Statistik --------------------------------------------------------
    async [MSG.STATS_GET]() {
      return ok(summarize(await store.readStatistics()));
    },

    async [MSG.STATS_HISTORY](message) {
      const statistics = await store.readStatistics();
      return ok(getHistory(statistics, Number(message.days) || 7));
    },

    async [MSG.STATS_TOP_DOMAINS](message) {
      return ok(getTopDomains(await store.readStatistics(), Number(message.limit) || 10));
    },

    async [MSG.STATS_TOP_SITES](message) {
      return ok(getTopSites(await store.readSiteStats(), Number(message.limit) || 10));
    },

    async [MSG.STATS_RESET]() {
      const { createEmptyStatistics } = await import('../core/statistics.js');
      const { createEmptySiteStats } = await import('../core/site-stats.js');
      await store.writeStatistics(createEmptyStatistics());
      await store.writeSiteStats(createEmptySiteStats());
      await chrome.action.setBadgeText({ text: '' });
      broadcast(MSG.PUSH_STATS, summarize(await store.readStatistics()));
      return ok({ reset: true });
    },

    async [MSG.STATS_RECORD_COSMETIC](message, sender) {
      const hostname = extractHostname(sender?.tab?.url) ?? message.hostname ?? null;
      enqueueBlock({
        domain: null,
        category: 'cosmetic',
        resourceType: 'other',
        initiatorHost: hostname,
        count: Number(message.count) || 1,
      });
      scheduleFlush({
        logger,
        onFlushed: (statistics) => broadcast(MSG.PUSH_STATS, summarize(statistics)),
      });
      return ok({ accepted: true });
    },

    // ---- Sicherung --------------------------------------------------------
    async [MSG.SETTINGS_EXPORT]() {
      const settings = await store.readSettings();
      const version = chrome.runtime.getManifest().version;
      return ok({ json: settingsApi.exportSettings(settings, version) });
    },

    async [MSG.SETTINGS_IMPORT](message) {
      const result = settingsApi.importSettings(message.json);
      if (!result.ok) return fail(result.error, 'IMPORT_FAILED');
      await commit(result.settings);
      return ok({ settings: result.settings });
    },

    async [MSG.SETTINGS_RESET]() {
      const { createDefaultSettings } = await import('../core/settings-schema.js');
      const defaults = createDefaultSettings();
      await commit(defaults);
      return ok({ settings: defaults });
    },

    // ---- Diagnose ---------------------------------------------------------
    async [MSG.DIAGNOSTICS_GET]() {
      return ok(await buildDiagnostics({ logger }));
    },

    async [MSG.DIAGNOSTICS_EXPORT]() {
      const report = await buildDiagnostics({ logger });
      return ok({ text: formatDiagnosticsReport(report, logger.toText()) });
    },

    async [MSG.DIAGNOSTICS_SET_LEVEL](message) {
      if (!logger.setLevel(message.level)) {
        return fail('Unbekannte Protokollstufe.', 'INVALID_LEVEL');
      }
      const settings = await store.readSettings();
      await store.writeSettings({
        ...settingsApi.cloneSettings(settings),
        diagnostics: { logLevel: message.level },
      });
      return ok({ logLevel: message.level });
    },

    async [MSG.DIAGNOSTICS_SELFTEST]() {
      return ok(await runSelfTest({ logger }));
    },

    // ---- Onboarding -------------------------------------------------------
    async [MSG.ONBOARDING_COMPLETE](message) {
      const settings = await store.readSettings();
      let next = settingsApi.cloneSettings(settings);
      if (message.protectionLevel !== undefined) {
        next = settingsApi.applyProtectionLevel(next, message.protectionLevel);
      }
      if (message.uiMode === 'simple' || message.uiMode === 'expert') {
        next.uiMode = message.uiMode;
      }
      await commit(next);
      await store.writeOnboarding({
        completed: true,
        version: chrome.runtime.getManifest().version,
      });
      return ok({ settings: next });
    },
  };
}

/**
 * Stellt die Konfiguration zusammen, die ein Content-Script braucht.
 *
 * Bewusst knapp gehalten: Das Objekt geht an jede geladene Seite. Es enthält
 * ausschließlich, was zum Verstecken von Elementen nötig ist — insbesondere
 * **keine** Statistik und **nicht** die vollständige Whitelist. In v4 bekam jede
 * Seite die komplette Whitelist des Nutzers ausgehändigt, also die Liste aller
 * Domains, die er bewusst freigegeben hat.
 *
 * @param {import('../core/settings.js').Settings} settings
 * @param {string|null} hostname
 * @returns {object}
 */
export function buildContentConfig(settings, hostname) {
  const isWhitelisted = hostname ? isHostnameWhitelisted(hostname, settings.whitelist) : false;
  const active = settings.masterEnabled && !isWhitelisted;

  return {
    active,
    isWhitelisted,
    cosmeticFiltersEnabled: settings.cosmeticFiltersEnabled,
    antiAdblockDefuseEnabled: settings.antiAdblockDefuseEnabled,
    categories: Object.fromEntries(
      Object.entries(settings.categories).map(([id, value]) => [id, { enabled: value.enabled }])
    ),
    elementRules: settingsApi
      .getElementRulesForHost(settings, hostname)
      .map((rule) => rule.selector),
  };
}

/**
 * Sammelt den Diagnosebericht.
 * @param {{logger: ReturnType<typeof import('../core/logger.js').createLogger>}} deps
 * @returns {Promise<object>}
 */
export async function buildDiagnostics({ logger }) {
  const manifest = chrome.runtime.getManifest();
  const settings = await store.readSettings();
  const statistics = await store.readStatistics();
  const presetMeta = await store.readPresetMeta();

  let dynamicRules = [];
  let rulesError = null;
  try {
    dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
  } catch (error) {
    rulesError = describeError(error);
  }

  return {
    version: manifest.version,
    browser: navigator.userAgent,
    generatedAt: new Date().toISOString(),
    masterEnabled: settings.masterEnabled,
    protectionLevel: settings.protectionLevel,
    uiMode: settings.uiMode,
    activeCategories: Object.entries(settings.categories)
      .filter(([, value]) => value.enabled)
      .map(([id]) => id),
    whitelistCount: settings.whitelist.length,
    customRuleCount: settings.customRules.length,
    elementRuleCount: settings.elementRules.length,
    dynamicRuleCount: dynamicRules.length,
    dynamicRuleLimit: getDynamicRuleLimit(),
    rulesError,
    statsTotal: statistics.total,
    statsDays: Object.keys(statistics.days).length,
    pendingStatsEvents: getBufferSize(),
    onRuleMatchedDebugAvailable: Boolean(chrome.declarativeNetRequest?.onRuleMatchedDebug),
    presets: Object.entries(presetMeta).map(([id, meta]) => ({
      id,
      enabled: meta.enabled,
      ruleCount: meta.ruleCount,
      updatedAt: meta.updatedAt,
      lastError: meta.lastError,
    })),
    storage: await store.getStorageUsage(),
    logLevel: logger.getLevel(),
  };
}

/**
 * Formatiert den Diagnosebericht als Text zum Anhängen an einen Bugreport.
 * @param {object} report
 * @param {string} logText
 * @returns {string}
 */
export function formatDiagnosticsReport(report, logText) {
  const lines = [
    '=== pBlock Diagnosebericht ===',
    `Erstellt:            ${report.generatedAt}`,
    `Version:             ${report.version}`,
    `Browser:             ${report.browser}`,
    '',
    '--- Zustand ---',
    `Hauptschalter:       ${report.masterEnabled ? 'ein' : 'aus'}`,
    `Schutzstufe:         ${report.protectionLevel}`,
    `Anzeigemodus:        ${report.uiMode}`,
    `Aktive Kategorien:   ${report.activeCategories.join(', ') || '(keine)'}`,
    '',
    '--- Regeln ---',
    `Dynamische Regeln:   ${report.dynamicRuleCount} von max. ${report.dynamicRuleLimit}`,
    `Whitelist:           ${report.whitelistCount}`,
    `Eigene Regeln:       ${report.customRuleCount}`,
    `Element-Regeln:      ${report.elementRuleCount}`,
    report.rulesError ? `FEHLER beim Lesen:   ${report.rulesError}` : null,
    '',
    '--- Statistik ---',
    `Blockiert gesamt:    ${report.statsTotal}`,
    `Gespeicherte Tage:   ${report.statsDays}`,
    `Wartende Ereignisse: ${report.pendingStatsEvents}`,
    `onRuleMatchedDebug:  ${report.onRuleMatchedDebugAvailable ? 'verfügbar' : 'nicht verfügbar'}`,
    '',
    '--- Filterlisten ---',
    ...report.presets.map((preset) => {
      const status = preset.enabled ? 'aktiv  ' : 'inaktiv';
      const rules = String(preset.ruleCount).padStart(6);
      const error = preset.lastError ? `  FEHLER: ${preset.lastError}` : '';
      return `${preset.id.padEnd(20)} ${status} ${rules} Regeln${error}`;
    }),
    '',
    '--- Speicher ---',
    `Belegt:              ${report.storage.bytesInUse} von ${report.storage.quotaBytes} Bytes (${report.storage.percentage}%)`,
    '',
    '--- Protokoll ---',
    logText,
  ];

  return lines.filter((line) => line !== null).join('\n');
}

/**
 * Führt einen Selbsttest aus.
 *
 * Beantwortet die Frage, die Nutzer tatsächlich stellen: „Funktioniert das
 * Ding gerade überhaupt?“ v4 bot dafür nur einen Knopf, der eine Testzahl in die
 * Statistik schrieb — was genau nichts über den Zustand der Regeln aussagte.
 *
 * @param {{logger: ReturnType<typeof import('../core/logger.js').createLogger>}} deps
 * @returns {Promise<{checks: Array<{name: string, ok: boolean, detail: string}>, ok: boolean}>}
 */
export async function runSelfTest({ logger }) {
  /** @type {Array<{name: string, ok: boolean, detail: string}>} */
  const checks = [];

  const settings = await store.readSettings();
  checks.push({
    name: 'Hauptschalter',
    ok: settings.masterEnabled,
    detail: settings.masterEnabled ? 'eingeschaltet' : 'ausgeschaltet — es wird nichts blockiert',
  });

  const applied = await applyRulesNow({ logger });
  checks.push({
    name: 'Regeln anwendbar',
    ok: applied.ok,
    detail: applied.ok
      ? `${applied.ruleCount} Regeln aktiv (${applied.durationMs} ms)`
      : `Fehlgeschlagen: ${applied.error}`,
  });

  try {
    const active = await chrome.declarativeNetRequest.getDynamicRules();
    const expectationMet = settings.masterEnabled ? active.length > 0 : active.length === 0;
    checks.push({
      name: 'Regeln im Browser hinterlegt',
      ok: expectationMet,
      detail: `${active.length} Regeln gemeldet`,
    });
  } catch (error) {
    checks.push({
      name: 'Regeln im Browser hinterlegt',
      ok: false,
      detail: describeError(error),
    });
  }

  const storage = await store.getStorageUsage();
  checks.push({
    name: 'Speicherplatz',
    ok: storage.percentage < 90,
    detail: storage.percentage < 0 ? 'nicht ermittelbar' : `${storage.percentage}% belegt`,
  });

  const presetMeta = await store.readPresetMeta();
  const brokenPresets = Object.entries(presetMeta).filter(
    ([, meta]) => meta.enabled && meta.lastError
  );
  checks.push({
    name: 'Filterlisten',
    ok: brokenPresets.length === 0,
    detail:
      brokenPresets.length === 0
        ? 'keine Fehler'
        : `Fehler bei: ${brokenPresets.map(([id]) => id).join(', ')}`,
  });

  return { checks, ok: checks.every((check) => check.ok) };
}

/**
 * Registriert den Nachrichtenempfänger.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 */
export function registerMessageHandler({ logger }) {
  const handlers = createHandlers({ logger });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = handlers[message?.type];

    if (!handler) {
      logger.warn(`Unbekannter Nachrichtentyp: ${message?.type}`);
      sendResponse(fail(`Unbekannter Nachrichtentyp: ${message?.type}`, 'UNKNOWN_MESSAGE'));
      return false;
    }

    // Jeder Handler ist async. `true` hält den Antwortkanal offen.
    handler(message, sender)
      .then(sendResponse)
      .catch((error) => {
        logger.error(`Handler für ${message.type} fehlgeschlagen`, error);
        sendResponse(fail(describeError(error), 'HANDLER_ERROR'));
      });

    return true;
  });
}
