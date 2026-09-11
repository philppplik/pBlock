/**
 * Leveled Logger mit Ringpuffer.
 *
 * Warum nicht einfach `console.log`: In v4 waren ~40 unbedingte `console.log`
 * über den Service Worker verteilt. Für Nutzer waren sie wertlos (niemand öffnet
 * die SW-Konsole), für die Fehlersuche waren sie wertlos (nach dem Suspend des
 * Service Workers weg), und im Hot Path der Block-Erfassung kosteten sie Zeit.
 *
 * Dieser Logger
 *  - filtert über ein Level (Standard `warn`, damit die Konsole ruhig bleibt),
 *  - hält die letzten {@link RING_CAPACITY} Einträge im Speicher,
 *  - kann sie als Text exportieren, sodass Nutzer einem Bugreport ein echtes
 *    Protokoll beilegen können statt „geht nicht“.
 */

/** @typedef {'silent'|'error'|'warn'|'info'|'debug'} LogLevel */

/** Numerische Rangfolge der Level. */
const LEVEL_RANK = Object.freeze({
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
});

/** Anzahl der Einträge im Ringpuffer. */
export const RING_CAPACITY = 300;

/** Alle gültigen Level, z. B. für Dropdowns in der UI. */
export const LOG_LEVELS = Object.freeze(Object.keys(LEVEL_RANK));

/**
 * Erzeugt einen Logger.
 *
 * @param {object} [options]
 * @param {string} [options.scope='pBlock'] Präfix in der Konsole.
 * @param {LogLevel} [options.level='warn'] Anfangsschwelle.
 * @param {object} [options.sink] Ausgabeziel (in Tests ersetzbar), Standard `console`.
 * @param {() => number} [options.now=Date.now] Zeitquelle (in Tests ersetzbar).
 */
export function createLogger({ scope = 'pBlock', level = 'warn', sink, now = Date.now } = {}) {
  /** @type {LogLevel} */
  let currentLevel = LEVEL_RANK[level] === undefined ? 'warn' : level;
  /** @type {Array<{t:number, level:LogLevel, scope:string, message:string, details:string|null}>} */
  const ring = [];
  const output = sink ?? globalThis.console;

  function shouldPrint(entryLevel) {
    return LEVEL_RANK[entryLevel] <= LEVEL_RANK[currentLevel];
  }

  function push(entryLevel, message, details) {
    // Der Ringpuffer wird unabhängig von der Ausgabeschwelle gefüllt, damit nach
    // einem Fehler auch der Kontext davor noch vorhanden ist.
    ring.push({
      t: now(),
      level: entryLevel,
      scope,
      message: String(message),
      details: details === undefined ? null : safeStringify(details),
    });
    if (ring.length > RING_CAPACITY) ring.shift();

    if (!shouldPrint(entryLevel)) return;
    const prefix = `[${scope}]`;
    const method = entryLevel === 'debug' ? 'debug' : entryLevel;
    const fn = output?.[method] ?? output?.log;
    if (typeof fn !== 'function') return;
    if (details === undefined) fn.call(output, prefix, message);
    else fn.call(output, prefix, message, details);
  }

  const logger = {
    /** @param {string} message @param {unknown} [details] */
    debug: (message, details) => push('debug', message, details),
    /** @param {string} message @param {unknown} [details] */
    info: (message, details) => push('info', message, details),
    /** @param {string} message @param {unknown} [details] */
    warn: (message, details) => push('warn', message, details),
    /** @param {string} message @param {unknown} [details] */
    error: (message, details) => push('error', message, details),

    /** @returns {LogLevel} */
    getLevel: () => currentLevel,

    /**
     * Setzt die Ausgabeschwelle.
     * @param {LogLevel} next
     * @returns {boolean} `false`, wenn der Wert unbekannt war (Level bleibt unverändert).
     */
    setLevel(next) {
      if (LEVEL_RANK[next] === undefined) return false;
      currentLevel = next;
      return true;
    },

    /** Kopie des Ringpuffers, ältester Eintrag zuerst. */
    getEntries: () => ring.map((entry) => ({ ...entry })),

    /** Leert den Ringpuffer. */
    clear: () => {
      ring.length = 0;
    },

    /**
     * Rendert den Ringpuffer als Klartext für Bugreports.
     * @returns {string}
     */
    toText() {
      if (ring.length === 0) return 'Keine Protokolleinträge vorhanden.';
      return ring
        .map((entry) => {
          const time = new Date(entry.t).toISOString();
          const base = `${time} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}`;
          return entry.details ? `${base}\n    ${entry.details}` : base;
        })
        .join('\n');
    },

    /**
     * Kind-Logger mit eigenem Präfix, aber gemeinsamem Puffer und Level.
     * @param {string} childScope
     */
    child(childScope) {
      return {
        debug: (m, d) => push('debug', `${childScope}: ${m}`, d),
        info: (m, d) => push('info', `${childScope}: ${m}`, d),
        warn: (m, d) => push('warn', `${childScope}: ${m}`, d),
        error: (m, d) => push('error', `${childScope}: ${m}`, d),
      };
    },
  };

  return logger;
}

/**
 * Serialisiert beliebige Werte defensiv.
 *
 * `JSON.stringify` wirft bei zyklischen Strukturen und reduziert `Error`-Objekte
 * auf `{}`. Beides ist beim Debuggen genau das, was man nicht gebrauchen kann.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function safeStringify(value) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  }
  if (typeof value === 'string') return value;
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[zyklisch]';
          seen.add(val);
        }
        if (typeof val === 'bigint') return `${val}n`;
        if (typeof val === 'function') return `[Funktion ${val.name || 'anonym'}]`;
        return val;
      },
      2
    );
  } catch (error) {
    return `[nicht serialisierbar: ${error instanceof Error ? error.message : 'unbekannt'}]`;
  }
}

/**
 * Normalisiert einen unbekannten Fehlerwert zu einer lesbaren Meldung.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return safeStringify(error);
}
