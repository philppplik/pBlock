import { describe, expect, test } from 'vitest';
import {
  PRESETS,
  PRESET_SOURCE_HOSTS,
  PRESET_MAX_AGE_MS,
  createEmptyPresetMeta,
  describePresets,
  getStalePresetIds,
  isAllowedPresetUrl,
  normalizePresetMeta,
} from '../../src/core/presets.js';
import {
  RULE_REGISTRY,
  collapseRedundantDomains,
  getRegistryStats,
  getTotalRegistryEntries,
} from '../../src/core/rule-registry.js';
import { CATEGORY_TAXONOMY } from '../../src/core/settings-schema.js';

describe('normalizePresetMeta', () => {
  test('liefert für jede bekannte Liste einen Eintrag', () => {
    const meta = normalizePresetMeta(undefined);
    expect(Object.keys(meta).sort()).toEqual(Object.keys(PRESETS).sort());
  });

  test('verwirft unbekannte Listen', () => {
    const meta = normalizePresetMeta({ gibtsNicht: { enabled: true } });
    expect(meta.gibtsNicht).toBeUndefined();
  });

  test('übernimmt gültige Werte und ignoriert falsche Typen', () => {
    const meta = normalizePresetMeta({
      easylist: {
        enabled: true,
        ruleCount: 1234,
        updatedAt: 1000,
        lastError: 'Zeitüberschreitung',
      },
      easyprivacy: { enabled: 'ja', ruleCount: -5 },
    });
    expect(meta.easylist).toMatchObject({ enabled: true, ruleCount: 1234, updatedAt: 1000 });
    expect(meta.easyprivacy.enabled).toBe(false);
    expect(meta.easyprivacy.ruleCount).toBe(0);
  });

  test('kürzt überlange Fehlermeldungen', () => {
    const meta = normalizePresetMeta({ easylist: { lastError: 'x'.repeat(500) } });
    expect(meta.easylist.lastError.length).toBe(300);
  });
});

describe('getStalePresetIds', () => {
  const jetzt = 1_000_000_000;

  test('meldet aktive Listen ohne Download', () => {
    const meta = normalizePresetMeta({ easylist: { enabled: true } });
    expect(getStalePresetIds(meta, jetzt)).toEqual(['easylist']);
  });

  test('meldet aktive Listen mit zu altem Download', () => {
    const meta = normalizePresetMeta({
      easylist: { enabled: true, updatedAt: jetzt - PRESET_MAX_AGE_MS - 1 },
    });
    expect(getStalePresetIds(meta, jetzt)).toEqual(['easylist']);
  });

  test('ignoriert frische und inaktive Listen', () => {
    const meta = normalizePresetMeta({
      easylist: { enabled: true, updatedAt: jetzt - 1000 },
      easyprivacy: { enabled: false },
    });
    expect(getStalePresetIds(meta, jetzt)).toEqual([]);
  });
});

describe('describePresets', () => {
  test('verbindet Definition und Zustand', () => {
    const beschreibung = describePresets(normalizePresetMeta({ easylist: { enabled: true } }), 0);
    const easylist = beschreibung.find((entry) => entry.id === 'easylist');
    expect(easylist?.name).toBe('EasyList');
    expect(easylist?.enabled).toBe(true);
    expect(easylist?.isStale).toBe(true);
  });
});

describe('isAllowedPresetUrl', () => {
  test('akzeptiert HTTPS-Quellen', () => {
    expect(isAllowedPresetUrl('https://easylist.to/easylist/easylist.txt')).toBe(true);
  });

  test.each([
    'http://easylist.to/liste.txt',
    'https://nutzer:geheim@example.com/liste.txt',
    'https://192.168.1.1/liste.txt',
    'ftp://example.com/liste.txt',
    'kein-url',
    null,
  ])('lehnt %s ab', (url) => {
    expect(isAllowedPresetUrl(url)).toBe(false);
  });

  test('alle mitgelieferten Quellen sind zulässig', () => {
    for (const preset of Object.values(PRESETS)) {
      for (const url of preset.urls) {
        expect(isAllowedPresetUrl(url), `${preset.id}: ${url}`).toBe(true);
      }
    }
  });

  // Eine einzige Quelle je Liste war in v5.0.0 ein Einzelfehlerpunkt: Fällt
  // easylist.to aus, bekommt der Nutzer keine Aktualisierung mehr.
  test('jede Liste nennt mindestens eine Quelle', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset.urls.length, preset.id).toBeGreaterThan(0);
    }
  });

  test('die Ersatzquellen liegen auf anderen Servern', () => {
    // Ausnahme: Für Peter Lowe's List gibt es keinen unabhängigen Spiegel.
    const mitEchtemSpiegel = Object.values(PRESETS).filter((preset) => {
      const hosts = new Set(preset.urls.map((url) => new URL(url).hostname));
      return hosts.size > 1;
    });
    expect(mitEchtemSpiegel.length).toBeGreaterThanOrEqual(4);
  });

  test('PRESET_SOURCE_HOSTS enthält jeden Quell-Host genau einmal', () => {
    const alle = Object.values(PRESETS).flatMap((preset) =>
      preset.urls.map((url) => new URL(url).hostname)
    );
    expect([...PRESET_SOURCE_HOSTS].sort()).toEqual([...new Set(alle)].sort());
  });
});

describe('createEmptyPresetMeta', () => {
  test('startet mit neutralen Werten', () => {
    expect(createEmptyPresetMeta()).toEqual({
      enabled: false,
      ruleCount: 0,
      sourceEntries: 0,
      sourceUrl: null,
      updatedAt: null,
      lastError: null,
    });
  });
});

describe('Regel-Registry', () => {
  test('jede Unterkategorie der Taxonomie hat Filterdaten', () => {
    for (const [categoryId, meta] of Object.entries(CATEGORY_TAXONOMY)) {
      for (const subId of Object.keys(meta.subcategories)) {
        expect(RULE_REGISTRY[categoryId]?.[subId], `${categoryId}.${subId} fehlt`).toBeDefined();
      }
    }
  });

  test('jede Filtergruppe hat Einträge in der Taxonomie', () => {
    for (const [categoryId, subcategories] of Object.entries(RULE_REGISTRY)) {
      for (const subId of Object.keys(subcategories)) {
        expect(
          CATEGORY_TAXONOMY[categoryId]?.subcategories[subId],
          `${categoryId}.${subId} ohne Beschreibung`
        ).toBeDefined();
      }
    }
  });

  test('alle Domains sind kleingeschrieben und ohne Schema', () => {
    for (const subcategories of Object.values(RULE_REGISTRY)) {
      for (const group of Object.values(subcategories)) {
        for (const domain of group.domains) {
          expect(domain).toBe(domain.toLowerCase());
          expect(domain).not.toContain('://');
          expect(domain).not.toContain('/');
        }
      }
    }
  });

  // Regression: v4 blockierte t.co unter "twitter". Damit war jeder von X
  // geteilte Link tot — ein Totalausfall für den Nutzer, kein Gewinn.
  test('blockiert keine Domains, die Kernfunktionen zerstören', () => {
    const alle = Object.values(RULE_REGISTRY).flatMap((subcategories) =>
      Object.values(subcategories).flatMap((group) => group.domains)
    );
    for (const gefaehrlich of ['t.co', 'facebook.com', 'twitter.com', 'x.com', 'google.com']) {
      expect(alle, `${gefaehrlich} darf nicht als ganze Domain blockiert werden`).not.toContain(
        gefaehrlich
      );
    }
  });

  test('getRegistryStats zählt konsistent', () => {
    const stats = getRegistryStats();
    for (const [categoryId, entry] of Object.entries(stats)) {
      const summe = Object.values(entry.subcategories).reduce((acc, value) => acc + value, 0);
      expect(entry.total, categoryId).toBe(summe);
    }
    expect(getTotalRegistryEntries()).toBeGreaterThan(150);
  });
});

describe('collapseRedundantDomains', () => {
  test('entfernt Subdomains, die bereits abgedeckt sind', () => {
    expect(collapseRedundantDomains(['media.net', 'static.media.net', 'a.test'])).toEqual([
      'a.test',
      'media.net',
    ]);
  });

  test('behält unabhängige Domains', () => {
    expect(collapseRedundantDomains(['a.test', 'b.test'])).toEqual(['a.test', 'b.test']);
  });

  test('entfernt Duplikate und leere Werte', () => {
    expect(collapseRedundantDomains(['a.test', 'a.test', '', null])).toEqual(['a.test']);
  });

  test('lässt sich nicht von ähnlichen Namen täuschen', () => {
    expect(collapseRedundantDomains(['ard.de', 'boulevard.de'])).toEqual([
      'ard.de',
      'boulevard.de',
    ]);
  });
});
