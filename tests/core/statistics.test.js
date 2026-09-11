import { describe, expect, test } from 'vitest';
import {
  categoryForRuleId,
  createEmptyStatistics,
  formatBytes,
  formatCount,
  getCategoryBreakdown,
  getHistory,
  getPeakHour,
  getTodayHourly,
  getTodayTotal,
  getTopDomains,
  getWeekTotal,
  normalizeStatistics,
  pruneStatistics,
  recordBlocks,
  summarize,
} from '../../src/core/statistics.js';
import { HISTORY_RETENTION_DAYS, TOP_DOMAIN_LIMIT } from '../../src/core/constants.js';

const AM_MITTAG = new Date(2026, 8, 11, 12, 0, 0);

describe('recordBlocks', () => {
  test('erhöht Gesamt-, Tages- und Stundenwerte', () => {
    const state = recordBlocks(createEmptyStatistics(), {
      domain: 'werbung.test',
      category: 'ads',
      resourceType: 'script',
      at: AM_MITTAG,
    });

    expect(state.total).toBe(1);
    expect(getTodayTotal(state, AM_MITTAG)).toBe(1);
    expect(getTodayHourly(state, AM_MITTAG)[12]).toBe(1);
    expect(state.domains['werbung.test']).toBe(1);
    expect(state.bandwidthBytes).toBe(50 * 1024);
  });

  test('verbucht gebündelte Meldungen in einem Schritt', () => {
    const state = recordBlocks(createEmptyStatistics(), { count: 40, at: AM_MITTAG });
    expect(state.total).toBe(40);
    expect(getTodayHourly(state, AM_MITTAG)[12]).toBe(40);
  });

  test('ignoriert unbrauchbare Anzahlen', () => {
    const leer = createEmptyStatistics();
    expect(recordBlocks(leer, { count: 0 })).toBe(leer);
    expect(recordBlocks(leer, { count: -3 })).toBe(leer);
    expect(recordBlocks(leer, { count: NaN })).toBe(leer);
  });

  test('verändert den Ausgangszustand nicht', () => {
    const leer = createEmptyStatistics();
    recordBlocks(leer, { at: AM_MITTAG, count: 5 });
    expect(leer.total).toBe(0);
  });

  // Regression: v4 hielt today/week als eigene Zähler und musste beim
  // Tageswechsel zurücksetzen. Eine der drei Implementierungen archivierte dabei
  // die Stundendaten des NEUEN Tages unter dem ALTEN Datum.
  test('trennt Tage sauber, ganz ohne Rollover-Logik', () => {
    let state = recordBlocks(createEmptyStatistics(), { count: 5, at: new Date(2026, 8, 10, 23) });
    state = recordBlocks(state, { count: 3, at: new Date(2026, 8, 11, 1) });

    expect(getTodayTotal(state, new Date(2026, 8, 10))).toBe(5);
    expect(getTodayTotal(state, new Date(2026, 8, 11))).toBe(3);
    expect(state.total).toBe(8);
  });
});

describe('getWeekTotal', () => {
  // Regression: v4 setzte den Wochenzähler auf 0, sobald sich die Wochenzahl
  // geändert hatte — auch wenn der Browser nur ein paar Tage aus war.
  test('summiert die Tage der laufenden ISO-Woche', () => {
    let state = createEmptyStatistics();
    // Mo 7.9.2026 bis Fr 11.9.2026 liegen in derselben ISO-Woche.
    for (const tag of [7, 8, 9, 10, 11]) {
      state = recordBlocks(state, { count: 2, at: new Date(2026, 8, tag, 10) });
    }
    expect(getWeekTotal(state, new Date(2026, 8, 11))).toBe(10);
  });

  test('zählt die Vorwoche nicht mit', () => {
    let state = recordBlocks(createEmptyStatistics(), { count: 99, at: new Date(2026, 8, 4, 10) });
    state = recordBlocks(state, { count: 2, at: new Date(2026, 8, 9, 10) });
    expect(getWeekTotal(state, new Date(2026, 8, 9))).toBe(2);
  });
});

describe('pruneStatistics', () => {
  test('entfernt Tage jenseits der Aufbewahrungsfrist', () => {
    let state = createEmptyStatistics();
    const alt = new Date(2026, 8, 11 - HISTORY_RETENTION_DAYS - 5);
    state = recordBlocks(state, { count: 1, at: alt });
    state = recordBlocks(state, { count: 1, at: AM_MITTAG });

    expect(Object.keys(state.days)).toEqual(['2026-09-11']);
  });

  // Regression: v4 löschte die Tagesdaten, ließ die Stundenhistorie aber stehen.
  test('lässt keine verwaisten Stundendaten zurück', () => {
    let state = createEmptyStatistics();
    for (let i = 0; i < HISTORY_RETENTION_DAYS + 20; i += 1) {
      state = recordBlocks(state, { count: 1, at: new Date(2026, 8, 11 - i) });
    }
    expect(Object.keys(state.days).length).toBeLessThanOrEqual(HISTORY_RETENTION_DAYS);
    for (const bucket of Object.values(state.days)) {
      expect(bucket.hours).toHaveLength(24);
    }
  });

  test('begrenzt die Domainliste auf die häufigsten Einträge', () => {
    let state = createEmptyStatistics();
    for (let i = 0; i < TOP_DOMAIN_LIMIT + 50; i += 1) {
      state = recordBlocks(state, { domain: `d${i}.test`, count: i + 1, at: AM_MITTAG });
    }
    expect(Object.keys(state.domains).length).toBeLessThanOrEqual(TOP_DOMAIN_LIMIT);
  });

  test('gibt bei nichts zu tun dasselbe Objekt zurück', () => {
    const state = recordBlocks(createEmptyStatistics(), { count: 1, at: AM_MITTAG });
    expect(pruneStatistics(state, AM_MITTAG)).toBe(state);
  });
});

describe('normalizeStatistics', () => {
  test('repariert unbrauchbare Eingaben', () => {
    for (const input of [undefined, null, 'text', []]) {
      expect(normalizeStatistics(input).total).toBe(0);
    }
  });

  test('verwirft ungültige Tagesschlüssel und negative Werte', () => {
    const state = normalizeStatistics({
      total: -5,
      days: { 'Fri Sep 11 2026': { total: 9 }, '2026-09-11': { total: 3, hours: [1] } },
      domains: { 'a.test': 5, 'b.test': -1 },
    });
    expect(state.total).toBe(0);
    expect(Object.keys(state.days)).toEqual(['2026-09-11']);
    expect(state.days['2026-09-11'].hours).toHaveLength(24);
    expect(state.domains).toEqual({ 'a.test': 5 });
  });
});

describe('Auswertungen', () => {
  let state = createEmptyStatistics();
  state = recordBlocks(state, { count: 5, category: 'ads', domain: 'a.test', at: AM_MITTAG });
  state = recordBlocks(state, { count: 3, category: 'analytics', domain: 'b.test', at: AM_MITTAG });
  state = recordBlocks(state, {
    count: 1,
    category: 'ads',
    domain: 'a.test',
    at: new Date(2026, 8, 10, 9),
  });

  test('getHistory liefert einen Eintrag je Tag', () => {
    const verlauf = getHistory(state, 7, AM_MITTAG);
    expect(verlauf).toHaveLength(7);
    expect(verlauf.at(-1)).toMatchObject({ date: '2026-09-11', label: 'Heute', count: 8 });
    expect(verlauf.at(-2)).toMatchObject({ label: 'Gestern', count: 1 });
  });

  test('getTopDomains sortiert absteigend', () => {
    expect(getTopDomains(state, 2)).toEqual([
      { domain: 'a.test', count: 6 },
      { domain: 'b.test', count: 3 },
    ]);
  });

  test('getCategoryBreakdown rechnet Prozentwerte', () => {
    const aufteilung = getCategoryBreakdown(state, 7, AM_MITTAG);
    expect(aufteilung[0]).toMatchObject({ category: 'ads', count: 6, percentage: 67 });
  });

  test('getPeakHour findet die Spitzenstunde', () => {
    expect(getPeakHour(state, AM_MITTAG)).toEqual({ hour: 12, count: 8 });
  });

  test('getPeakHour meldet -1, wenn es keine Daten gibt', () => {
    expect(getPeakHour(createEmptyStatistics(), AM_MITTAG)).toEqual({ hour: -1, count: 0 });
  });

  test('summarize fasst alles zusammen', () => {
    const zusammenfassung = summarize(state, AM_MITTAG);
    expect(zusammenfassung.today).toBe(8);
    expect(zusammenfassung.total).toBe(9);
    expect(zusammenfassung.bandwidthFormatted).toMatch(/KB|MB/);
  });
});

describe('Formatierung', () => {
  test.each([
    [0, '0 KB'],
    [512, '512 B'],
    [2048, '2,0 KB'],
    [5 * 1024 * 1024, '5,0 MB'],
    [3 * 1024 ** 3, '3,00 GB'],
    [-1, '0 KB'],
  ])('formatBytes(%i) = %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  test.each([
    [0, '0'],
    [999, '999'],
    [12_400, '12,4 Tsd.'],
    [2_500_000, '2,5 Mio.'],
  ])('formatCount(%i) = %s', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });
});

describe('categoryForRuleId', () => {
  test.each([
    [1, null],
    [999, null],
    [1_000, 'custom'],
    [10_000, 'category'],
    [20_000, 'presets'],
    [undefined, null],
  ])('ID %s → %s', (id, expected) => {
    expect(categoryForRuleId(id)).toBe(expected);
  });
});
