/**
 * Lebenszyklus des Service Workers: Installation, Start, Kontextmenü, Tastenkürzel,
 * Alarme und Benachrichtigungen.
 *
 * ## Ein Detail, das in v4 fehlte
 *
 * `chrome.runtime.onInstalled` feuert auch bei einem **Update**. v4 behandelte nur
 * `reason === 'install'` gesondert und rief ansonsten lediglich `applyRules()` auf.
 * Eine Schema-Migration fand nie statt — die Einstellungen aus einer älteren
 * Version wurden einfach weiter mit den neuen Feldnamen gelesen, was stillschweigend
 * auf Standardwerte zurückfiel.
 */

import { MSG } from '../core/messages.js';
import { describeError } from '../core/logger.js';
import { isRestrictedUrl } from '../core/domain.js';
import { migrateLegacySettings, normalizeSettings } from '../core/settings.js';
import { SETTINGS_SCHEMA_VERSION, STORAGE_KEYS } from '../core/constants.js';
import * as store from './storage.js';
import { applyRulesNow } from './rule-applier.js';
import {
  POLL_ALARM_NAME,
  ensurePollAlarm,
  flushBuffer,
  pollActiveTab,
  updateBadge,
} from './stats-collector.js';
import { UPDATE_ALARM_NAME, ensureUpdateAlarm, updateStalePresets } from './preset-manager.js';
import { PRESETS } from '../core/presets.js';
import { removePresetRules } from './storage.js';

/**
 * Schema-Version der gespeicherten Listen-Regeln.
 *
 * Erhöhen, wenn eine Parser-Änderung dazu führt, dass bereits gespeicherte
 * Regeln neu erzeugt werden müssen. Die Regeln werden dann beim nächsten Start
 * verworfen und frisch geholt.
 */
const PRESET_RULES_SCHEMA = 2;

/**
 * Verwirft gespeicherte Listen-Regeln, wenn sie von einem älteren Parser stammen.
 *
 * Der Anlass ist konkret: v5.0.0 übersetzte die Zeile
 * `|https:$domain=adfarm1.adition.com` aus EasyList Germany in eine Regel, die
 * jede HTTPS-Anfrage blockierte. Sie lag danach im Speicher und wurde bei jedem
 * Start erneut angewendet — auch nach einem Update der Erweiterung, denn die
 * Regeln werden ja nicht neu geparst, sondern aus dem Speicher geladen.
 *
 * Ohne diesen Schritt hätte selbst die korrigierte Fassung den Fehler weiter
 * mitgeschleppt. Ein erneuter Download kostet ein paar Megabyte; das ist der
 * Preis dafür, dass niemand von Hand aufräumen muss.
 *
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} logger
 * @returns {Promise<boolean>} Ob etwas verworfen wurde.
 */
export async function discardOutdatedPresetRules(logger) {
  const stored = await chrome.storage.local.get('presetRulesSchema');
  if (stored.presetRulesSchema === PRESET_RULES_SCHEMA) return false;

  const log = logger.child('Migration');
  log.info('Gespeicherte Listen-Regeln stammen von einem älteren Parser — werden neu geholt');

  for (const id of Object.keys(PRESETS)) {
    await removePresetRules(id);
  }

  // Zeitstempel zurücksetzen, damit `updateStalePresets` sie als veraltet ansieht.
  const meta = await store.readPresetMeta();
  for (const id of Object.keys(meta)) {
    meta[id] = { ...meta[id], updatedAt: null, ruleCount: 0, lastError: null };
  }
  await store.writePresetMeta(meta);

  await chrome.storage.local.set({ presetRulesSchema: PRESET_RULES_SCHEMA });
  return true;
}

/** IDs der Kontextmenü-Einträge. */
const MENU = Object.freeze({
  BLOCK_ELEMENT: 'pblock:block-element',
  TOGGLE_SITE: 'pblock:toggle-site',
  SEPARATOR: 'pblock:separator',
  OPTIONS: 'pblock:options',
});

/**
 * Legt das Kontextmenü an.
 *
 * `removeAll` vorweg ist nötig, weil `onInstalled` bei jedem Update erneut läuft
 * und `create` sonst mit „duplicate id“ scheitert.
 *
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} logger
 */
export function createContextMenus(logger) {
  chrome.contextMenus.removeAll(() => {
    // Fehler hier ist nicht kritisch, muss aber sichtbar sein.
    if (chrome.runtime.lastError) {
      logger.warn(`Kontextmenü konnte nicht geleert werden: ${chrome.runtime.lastError.message}`);
    }

    const entries = [
      { id: MENU.BLOCK_ELEMENT, title: 'Element auf dieser Seite blockieren' },
      { id: MENU.TOGGLE_SITE, title: 'pBlock auf dieser Seite pausieren' },
      { id: MENU.SEPARATOR, type: 'separator' },
      { id: MENU.OPTIONS, title: 'pBlock-Einstellungen öffnen' },
    ];

    for (const entry of entries) {
      chrome.contextMenus.create(
        {
          ...entry,
          contexts: ['page', 'frame', 'image', 'link', 'video'],
          // Auf chrome:// und im Web Store hat die Erweiterung ohnehin keinen
          // Zugriff — dort das Menü anzubieten führt nur zu Klicks ins Leere.
          documentUrlPatterns: ['http://*/*', 'https://*/*'],
        },
        () => {
          if (chrome.runtime.lastError) {
            logger.warn(
              `Menüeintrag ${entry.id} fehlgeschlagen: ${chrome.runtime.lastError.message}`
            );
          }
        }
      );
    }
  });
}

/**
 * Aktualisiert den Titel des Pausieren-Eintrags passend zum aktuellen Tab.
 * @param {boolean} isWhitelisted
 */
async function updateToggleMenuTitle(isWhitelisted) {
  try {
    await chrome.contextMenus.update(MENU.TOGGLE_SITE, {
      title: isWhitelisted
        ? 'pBlock auf dieser Seite wieder aktivieren'
        : 'pBlock auf dieser Seite pausieren',
    });
  } catch {
    // Das Menü existiert noch nicht oder wurde bereits entfernt.
  }
}

/**
 * Verarbeitet Klicks im Kontextmenü.
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {Record<string, Function>} deps.handlers
 */
export function registerContextMenuHandler({ logger, handlers }) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const run = async () => {
      switch (info.menuItemId) {
        case MENU.BLOCK_ELEMENT:
          if (typeof tab?.id === 'number' && !isRestrictedUrl(tab.url)) {
            await chrome.tabs.sendMessage(tab.id, { type: MSG.PICKER_ACTIVATE });
          }
          break;

        case MENU.TOGGLE_SITE: {
          const result = await handlers[MSG.WHITELIST_TOGGLE_ACTIVE_TAB]({}, { tab });
          if (result.ok) {
            await updateToggleMenuTitle(result.data.isWhitelisted);
            // Die Seite neu laden, damit die geänderte Regel sofort greift.
            if (typeof tab?.id === 'number') await chrome.tabs.reload(tab.id);
          }
          break;
        }

        case MENU.OPTIONS:
          await chrome.runtime.openOptionsPage();
          break;

        default:
          break;
      }
    };

    run().catch((error) => logger.error('Kontextmenü-Aktion fehlgeschlagen', error));
  });
}

/**
 * Verarbeitet Tastenkürzel.
 *
 * Neu in v5: v4 hatte gar keine. Für eine Erweiterung, die man mehrmals täglich
 * kurz pausiert, ist das ein spürbarer Unterschied.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {Record<string, Function>} deps.handlers
 */
export function registerCommandHandler({ logger, handlers }) {
  if (!chrome.commands?.onCommand) return;

  chrome.commands.onCommand.addListener((command) => {
    const run = async () => {
      switch (command) {
        case 'toggle-master': {
          const settings = await store.readSettings();
          await handlers[MSG.SET_MASTER_ENABLED]({ enabled: !settings.masterEnabled });
          break;
        }
        case 'toggle-site': {
          const result = await handlers[MSG.WHITELIST_TOGGLE_ACTIVE_TAB]({});
          if (result.ok) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (typeof tab?.id === 'number') await chrome.tabs.reload(tab.id);
          }
          break;
        }
        case 'activate-picker':
          await handlers[MSG.PICKER_ACTIVATE]({});
          break;
        default:
          break;
      }
    };

    run().catch((error) => logger.error(`Tastenkürzel ${command} fehlgeschlagen`, error));
  });
}

/**
 * Führt fällige Schema-Migrationen aus.
 *
 * Liest zusätzlich die alten `chrome.storage.sync`-Daten aus v4 ein, damit ein
 * Update die Einstellungen nicht verliert.
 *
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} logger
 * @returns {Promise<{migrated: boolean, from: string}>}
 */
export async function migrateIfNeeded(logger) {
  const log = logger.child('Migration');
  const current = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);

  if (current[STORAGE_KEYS.SETTINGS]?.schemaVersion === SETTINGS_SCHEMA_VERSION) {
    return { migrated: false, from: 'aktuell' };
  }

  // Fall 1: Es gibt bereits lokale Einstellungen in einem älteren Schema.
  if (current[STORAGE_KEYS.SETTINGS]) {
    const migrated = normalizeSettings(migrateLegacySettings(current[STORAGE_KEYS.SETTINGS]));
    await store.writeSettings(migrated);
    log.info('Lokale Einstellungen auf das aktuelle Schema gehoben');
    return { migrated: true, from: 'local' };
  }

  // Fall 2: v4 lag in `chrome.storage.sync`. Einmalig übernehmen.
  try {
    const legacy = await chrome.storage.sync.get(null);
    if (legacy && Object.keys(legacy).length > 0) {
      const migrated = normalizeSettings(migrateLegacySettings(legacy));
      await store.writeSettings(migrated);
      log.info('Einstellungen aus v4 (chrome.storage.sync) übernommen', {
        whitelist: migrated.whitelist.length,
        eigeneRegeln: migrated.customRules.length,
        elementRegeln: migrated.elementRules.length,
      });
      return { migrated: true, from: 'sync' };
    }
  } catch (error) {
    log.warn('Alte Einstellungen konnten nicht gelesen werden', describeError(error));
  }

  // Fall 3: Neuinstallation.
  await store.writeSettings(normalizeSettings(undefined));
  return { migrated: false, from: 'neu' };
}

/**
 * Registriert Installation und Start.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {Record<string, Function>} deps.handlers
 */
export function registerLifecycle({ logger, handlers }) {
  chrome.runtime.onInstalled.addListener((details) => {
    const run = async () => {
      logger.info(`Installiert/aktualisiert (${details.reason})`, {
        vorherigeVersion: details.previousVersion ?? null,
      });

      await migrateIfNeeded(logger);

      // Muss vor `applyRulesNow` laufen: Sonst werden die alten, womöglich
      // fehlerhaften Regeln noch einmal angewendet.
      const discarded = await discardOutdatedPresetRules(logger);

      createContextMenus(logger);
      ensurePollAlarm();
      ensureUpdateAlarm();
      await applyRulesNow({ logger });

      if (discarded) {
        // Sofort neu holen statt auf den Sechs-Stunden-Takt zu warten — bis
        // dahin wäre der Nutzer ohne Listenschutz.
        const result = await updateStalePresets({ logger });
        if (result.updated.length > 0) await applyRulesNow({ logger });
      }

      if (details.reason === 'install') {
        const onboarding = await store.readOnboarding();
        if (!onboarding.completed) {
          await chrome.tabs.create({ url: chrome.runtime.getURL('ui/onboarding/index.html') });
        }
      }
    };

    run().catch((error) => logger.error('Installationsroutine fehlgeschlagen', error));
  });

  chrome.runtime.onStartup.addListener(() => {
    const run = async () => {
      logger.info('Browser gestartet');
      ensurePollAlarm();
      ensureUpdateAlarm();
      await applyRulesNow({ logger });
      await updateBadge(await store.readStatistics());
    };

    run().catch((error) => logger.error('Startroutine fehlgeschlagen', error));
  });

  // Beim Tabwechsel den Menütitel anpassen, damit „pausieren“ und „aktivieren“
  // zum tatsächlichen Zustand der Seite passen.
  chrome.tabs.onActivated.addListener(() => {
    handlers[MSG.GET_POPUP_STATE]({})
      .then((result) => {
        if (result.ok) updateToggleMenuTitle(result.data.tab.isWhitelisted);
      })
      .catch(() => {});
  });
}

/**
 * Registriert die Alarm-Behandlung.
 *
 * Alarme sind im Service Worker der einzig verlässliche Taktgeber: Sie wecken ihn
 * auf, während `setInterval` mit ihm verschwindet.
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @param {(payload: unknown) => void} deps.onStatsUpdated
 */
export function registerAlarms({ logger, onStatsUpdated }) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    const run = async () => {
      switch (alarm.name) {
        case POLL_ALARM_NAME:
          await pollActiveTab({ logger, onFlushed: onStatsUpdated });
          // Auch ohne neue Treffer schreiben, falls noch etwas im Puffer liegt.
          await flushBuffer({ logger, onFlushed: onStatsUpdated });
          break;

        case UPDATE_ALARM_NAME: {
          const result = await updateStalePresets({ logger });
          if (result.updated.length > 0) await applyRulesNow({ logger });
          break;
        }

        default:
          break;
      }
    };

    run().catch((error) => logger.error(`Alarm ${alarm.name} fehlgeschlagen`, error));
  });
}

/**
 * Zeigt eine Meilenstein-Benachrichtigung.
 *
 * Bleibt bewusst zurückhaltend: nur bei runden Zahlen, nur wenn der Nutzer
 * Benachrichtigungen eingeschaltet hat, und höchstens einmal pro Meilenstein.
 *
 * @param {number} total
 * @param {object} deps
 * @param {ReturnType<typeof import('../core/logger.js').createLogger>} deps.logger
 * @returns {Promise<boolean>} Ob eine Benachrichtigung gezeigt wurde.
 */
export async function maybeNotifyMilestone(total, { logger }) {
  const MILESTONES = [1_000, 10_000, 100_000, 1_000_000];
  const reached = MILESTONES.filter((value) => total >= value).pop();
  if (!reached) return false;

  try {
    const settings = await store.readSettings();
    if (!settings.ui.showNotifications) return false;

    const stored = await chrome.storage.local.get('lastMilestone');
    if ((stored.lastMilestone ?? 0) >= reached) return false;

    await chrome.storage.local.set({ lastMilestone: reached });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'pBlock',
      message: `${reached.toLocaleString('de-DE')} blockierte Anfragen — die bleiben dir erspart.`,
      priority: 0,
    });
    return true;
  } catch (error) {
    logger.debug('Benachrichtigung nicht möglich', describeError(error));
    return false;
  }
}
