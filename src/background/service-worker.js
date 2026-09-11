/**
 * Einstiegspunkt des Service Workers.
 *
 * Die Datei tut bewusst nur eins: Abhängigkeiten zusammenstecken und Listener
 * registrieren. Jede Fachlichkeit liegt in einem eigenen Modul.
 *
 * ## Reihenfolge ist hier wichtig
 *
 * Chrome verlangt, dass alle Ereignis-Listener **synchron beim ersten Ausführen**
 * des Service Workers registriert werden. Wird ein Listener erst in einem
 * `await`-Zweig angemeldet, verpasst der gerade neu gestartete Service Worker
 * genau das Ereignis, das ihn geweckt hat. Deshalb steht unten alles
 * Registrierende vor jedem `await`.
 */

import { MSG } from '../core/messages.js';
import { createLogger } from '../core/logger.js';
import { summarize } from '../core/statistics.js';
import { readSettings, readStatistics, watchExternalChanges } from './storage.js';
import { scheduleApply } from './rule-applier.js';
import { registerDebugListener, updateBadge } from './stats-collector.js';
import {
  broadcast,
  createHandlers,
  registerLivePort,
  registerMessageHandler,
} from './messaging.js';
import {
  maybeNotifyMilestone,
  registerAlarms,
  registerCommandHandler,
  registerContextMenuHandler,
  registerLifecycle,
} from './lifecycle.js';

const logger = createLogger({ scope: 'pBlock', level: 'warn' });
const handlers = createHandlers({ logger });

/**
 * Wird aufgerufen, nachdem die Statistik geschrieben wurde.
 * @param {import('../core/statistics.js').StatisticsState} statistics
 */
function onStatsUpdated(statistics) {
  const summary = summarize(statistics);
  broadcast(MSG.PUSH_STATS, summary);
  maybeNotifyMilestone(statistics.total, { logger }).catch(() => {});
}

// --- Listener: synchron und als Erstes ---------------------------------------

registerMessageHandler({ logger });
registerLivePort();
registerLifecycle({ logger, handlers });
registerContextMenuHandler({ logger, handlers });
registerCommandHandler({ logger, handlers });
registerAlarms({ logger, onStatsUpdated });
registerDebugListener({ logger, onFlushed: onStatsUpdated });

watchExternalChanges((changedKeys) => {
  // Ändert eine andere Seite die Einstellungen direkt im Storage, müssen die
  // Regeln nachziehen. In v4 fiel das erst beim nächsten Neustart des Service
  // Workers auf.
  if (changedKeys.includes('settings')) {
    scheduleApply({ logger });
  }
});

// --- Verzögerte Initialisierung ----------------------------------------------

/**
 * Stellt den Zustand nach einem Neustart des Service Workers wieder her.
 *
 * Chrome beendet den Service Worker nach etwa 30 Sekunden Untätigkeit. Beim
 * nächsten Ereignis läuft diese Datei erneut von oben — Badge und Protokollstufe
 * müssen dann wiederhergestellt werden.
 */
async function restoreRuntimeState() {
  try {
    const settings = await readSettings();
    logger.setLevel(settings.diagnostics.logLevel);
    await updateBadge(await readStatistics());
    logger.debug('Laufzeitzustand wiederhergestellt');
  } catch (error) {
    logger.error('Laufzeitzustand konnte nicht wiederhergestellt werden', error);
  }
}

restoreRuntimeState();
