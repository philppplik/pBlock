import { describe, expect, test } from 'vitest';
import {
  SITE_HISTORY_DAYS,
  createEmptySiteStats,
  getSiteSummary,
  getTopSites,
  normalizeSiteStats,
  pruneSiteStats,
  recordSiteBlocks,
  removeSite,
} from '../../src/core/site-stats.js';
import { SITE_STATS_LIMIT } from '../../src/core/constants.js';

const HEUTE = new Date(2026, 8, 11, 12);

describe('recordSiteBlocks', () => {
  test('legt einen Eintrag an und zählt hoch', () => {
    const state = recordSiteBlocks(createEmptySiteStats(), {
      hostname: 'beispiel.test',
      category: 'ads',
      count: 3,
      at: HEUTE,
    });

    expect(state.sites['beispiel.test'].total).toBe(3);
    expect(state.sites['beispiel.test'].days['2026-09-11']).toBe(3);
    expect(state.sites['beispiel.test'].categories.ads).toBe(3);
  });

  test('ignoriert unbrauchbare Eingaben', () => {
    const leer = createEmptySiteStats();
    expect(recordSiteBlocks(leer, { hostname: '', count: 1 })).toBe(leer);
    expect(recordSiteBlocks(leer, { hostname: 'a.test', count: 0 })).toBe(leer);
    expect(recordSiteBlocks(leer, undefined)).toBe(leer);
  });

  test('verändert den Ausgangszustand nicht', () => {
    const leer = createEmptySiteStats();
    recordSiteBlocks(leer, { hostname: 'a.test', at: HEUTE });
    expect(Object.keys(leer.sites)).toEqual([]);
  });
});

describe('pruneSiteStats', () => {
  test('kürzt den Tagesverlauf je Website', () => {
    let state = createEmptySiteStats();
    for (let i = 0; i < SITE_HISTORY_DAYS + 10; i += 1) {
      state = recordSiteBlocks(state, { hostname: 'a.test', at: new Date(2026, 8, 11 - i) });
    }
    expect(Object.keys(state.sites['a.test'].days).length).toBeLessThanOrEqual(SITE_HISTORY_DAYS);
  });

  // Regression: v4 löschte hier nie und las bei JEDEM blockierten Request das
  // gesamte, unbegrenzt gewachsene Objekt aus dem Storage.
  test('begrenzt die Anzahl gespeicherter Websites', () => {
    let state = createEmptySiteStats();
    for (let i = 0; i < SITE_STATS_LIMIT + 25; i += 1) {
      state = recordSiteBlocks(state, { hostname: `s${i}.test`, count: i + 1, at: HEUTE });
    }
    expect(Object.keys(state.sites).length).toBeLessThanOrEqual(SITE_STATS_LIMIT);
    // Die Website mit den meisten Treffern muss überleben.
    expect(state.sites[`s${SITE_STATS_LIMIT + 24}.test`]).toBeDefined();
  });

  test('gibt bei nichts zu tun dasselbe Objekt zurück', () => {
    const state = recordSiteBlocks(createEmptySiteStats(), { hostname: 'a.test', at: HEUTE });
    expect(pruneSiteStats(state, HEUTE)).toBe(state);
  });
});

describe('normalizeSiteStats', () => {
  test('liest das flache v4-Format', () => {
    const state = normalizeSiteStats({
      'alt.test': { total: 7, days: { '2026-09-11': 7 }, categories: { ads: 7 } },
    });
    expect(state.sites['alt.test'].total).toBe(7);
  });

  test('verwirft unbrauchbare Einträge', () => {
    const state = normalizeSiteStats({
      sites: { 'a.test': { total: 5 }, 'b.test': 'kaputt', 'c.test': null },
    });
    expect(Object.keys(state.sites)).toEqual(['a.test']);
  });

  test('repariert unbrauchbare Eingaben', () => {
    for (const input of [undefined, null, 'text', []]) {
      expect(normalizeSiteStats(input).sites).toEqual({});
    }
  });
});

describe('Auswertungen', () => {
  let state = createEmptySiteStats();
  state = recordSiteBlocks(state, { hostname: 'a.test', count: 10, category: 'ads', at: HEUTE });
  state = recordSiteBlocks(state, { hostname: 'b.test', count: 4, at: HEUTE });

  test('getSiteSummary liefert Werte für eine Website', () => {
    expect(getSiteSummary(state, 'a.test', HEUTE)).toMatchObject({ total: 10, today: 10 });
  });

  test('getSiteSummary verträgt unbekannte und leere Hosts', () => {
    expect(getSiteSummary(state, 'gibtsnicht.test', HEUTE).total).toBe(0);
    expect(getSiteSummary(state, null, HEUTE).hostname).toBeNull();
  });

  test('getTopSites sortiert absteigend', () => {
    expect(getTopSites(state, 5, HEUTE).map((s) => s.hostname)).toEqual(['a.test', 'b.test']);
  });

  test('removeSite löscht gezielt', () => {
    expect(removeSite(state, 'a.test').sites['a.test']).toBeUndefined();
    expect(removeSite(state, 'gibtsnicht.test')).toBe(state);
  });
});
