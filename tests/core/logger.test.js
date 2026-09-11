import { describe, expect, test, vi } from 'vitest';
import {
  RING_CAPACITY,
  createLogger,
  describeError,
  safeStringify,
} from '../../src/core/logger.js';

/** Ausgabeziel, das statt der Konsole mitschreibt. */
function createSink() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

describe('Level-Filterung', () => {
  test('gibt standardmäßig nur warn und error aus', () => {
    const sink = createSink();
    const logger = createLogger({ sink });

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });

  test('silent unterdrückt alles', () => {
    const sink = createSink();
    const logger = createLogger({ sink, level: 'silent' });
    logger.error('still');
    expect(sink.error).not.toHaveBeenCalled();
  });

  test('setLevel akzeptiert nur bekannte Level', () => {
    const logger = createLogger({ sink: createSink() });
    expect(logger.setLevel('debug')).toBe(true);
    expect(logger.getLevel()).toBe('debug');
    expect(logger.setLevel('gibtsnicht')).toBe(false);
    expect(logger.getLevel()).toBe('debug');
  });
});

describe('Ringpuffer', () => {
  // Das ist der eigentliche Zweck: Nach einem Fehler soll auch der Kontext
  // davor verfügbar sein, selbst wenn er nie in der Konsole stand.
  test('zeichnet auch unterdrückte Einträge auf', () => {
    const logger = createLogger({ sink: createSink(), level: 'warn' });
    logger.debug('leiser Kontext');
    logger.error('der Knall');

    const eintraege = logger.getEntries();
    expect(eintraege).toHaveLength(2);
    expect(eintraege[0].message).toBe('leiser Kontext');
  });

  test('verwirft die ältesten Einträge bei Überlauf', () => {
    const logger = createLogger({ sink: createSink() });
    for (let i = 0; i < RING_CAPACITY + 50; i += 1) logger.info(`eintrag-${i}`);

    const eintraege = logger.getEntries();
    expect(eintraege).toHaveLength(RING_CAPACITY);
    expect(eintraege[0].message).toBe('eintrag-50');
  });

  test('clear leert den Puffer', () => {
    const logger = createLogger({ sink: createSink() });
    logger.warn('x');
    logger.clear();
    expect(logger.getEntries()).toEqual([]);
  });

  test('getEntries liefert Kopien', () => {
    const logger = createLogger({ sink: createSink() });
    logger.warn('original');
    const eintraege = logger.getEntries();
    eintraege[0].message = 'manipuliert';
    expect(logger.getEntries()[0].message).toBe('original');
  });
});

describe('toText', () => {
  test('rendert Einträge für Bugreports', () => {
    const logger = createLogger({ sink: createSink(), scope: 'Test', now: () => 0 });
    logger.error('Regeln konnten nicht geschrieben werden', { ruleCount: 42 });

    const text = logger.toText();
    expect(text).toContain('ERROR');
    expect(text).toContain('[Test]');
    expect(text).toContain('Regeln konnten nicht geschrieben werden');
    expect(text).toContain('"ruleCount": 42');
  });

  test('meldet einen leeren Puffer verständlich', () => {
    expect(createLogger({ sink: createSink() }).toText()).toBe(
      'Keine Protokolleinträge vorhanden.'
    );
  });
});

describe('child', () => {
  test('ergänzt den Präfix und teilt den Puffer', () => {
    const logger = createLogger({ sink: createSink() });
    logger.child('RuleApplier').warn('nichts zu tun');
    expect(logger.getEntries()[0].message).toBe('RuleApplier: nichts zu tun');
  });
});

describe('safeStringify', () => {
  test('behält Error-Objekte lesbar', () => {
    const text = safeStringify(new TypeError('kaputt'));
    expect(text).toContain('TypeError: kaputt');
  });

  // JSON.stringify wirft hier — genau der Fall, in dem man das Log braucht.
  test('verträgt zyklische Strukturen', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(safeStringify(a)).toContain('[zyklisch]');
  });

  test('stellt Funktionen und BigInt dar', () => {
    expect(safeStringify({ fn: function meineFunktion() {} })).toContain(
      '[Funktion meineFunktion]'
    );
    expect(safeStringify({ big: 10n })).toContain('10n');
  });

  test('reicht Strings unverändert durch', () => {
    expect(safeStringify('einfach')).toBe('einfach');
  });
});

describe('describeError', () => {
  test.each([
    [new Error('ups'), 'ups'],
    ['nur text', 'nur text'],
  ])('beschreibt %s', (input, expected) => {
    expect(describeError(input)).toBe(expected);
  });

  test('verträgt beliebige Werte', () => {
    expect(describeError({ code: 42 })).toContain('42');
  });
});
