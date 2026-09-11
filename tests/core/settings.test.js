import { describe, expect, test } from 'vitest';
import {
  LIMITS,
  addCustomRule,
  addElementRule,
  addToWhitelist,
  applyProtectionLevel,
  clearElementRules,
  exportSettings,
  getElementRulesForHost,
  importSettings,
  migrateLegacySettings,
  normalizeCustomRules,
  normalizeElementRules,
  normalizeSettings,
  normalizeWhitelist,
  removeCustomRule,
  removeElementRule,
  removeFromWhitelist,
  setCategoryEnabled,
  setSubcategoryEnabled,
  undoLastElementRule,
} from '../../src/core/settings.js';
import { createDefaultSettings } from '../../src/core/settings-schema.js';
import { SETTINGS_SCHEMA_VERSION } from '../../src/core/constants.js';

describe('normalizeSettings', () => {
  test('liefert Standardwerte für unbrauchbare Eingaben', () => {
    for (const input of [undefined, null, 'text', 42, []]) {
      const settings = normalizeSettings(input);
      expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(settings.masterEnabled).toBe(true);
    }
  });

  test('übernimmt gültige Werte', () => {
    const settings = normalizeSettings({
      masterEnabled: false,
      uiMode: 'expert',
      protectionLevel: 100,
    });
    expect(settings.masterEnabled).toBe(false);
    expect(settings.uiMode).toBe('expert');
    expect(settings.protectionLevel).toBe(100);
  });

  test('ignoriert Werte mit falschem Typ', () => {
    const settings = normalizeSettings({
      masterEnabled: 'ja',
      uiMode: 'irgendwas',
      protectionLevel: 42,
    });
    expect(settings.masterEnabled).toBe(true);
    expect(settings.uiMode).toBe('simple');
    expect(settings.protectionLevel).toBe(50);
  });

  // Regression: v4 schrieb Labels und Beschreibungen in den Storage zurück und
  // übernahm beim Lesen beliebige Schlüssel.
  test('verwirft unbekannte Kategorien und Zusatzfelder', () => {
    const settings = normalizeSettings({
      categories: {
        ads: { enabled: false, label: 'ALT', subcategories: { google: { enabled: false } } },
        gibtsNichtMehr: { enabled: true },
      },
      irgendwasFremdes: 'weg damit',
    });
    expect(settings.categories.ads.enabled).toBe(false);
    expect(settings.categories.ads.subcategories.google.enabled).toBe(false);
    expect(settings.categories.ads.label).toBeUndefined();
    expect(settings.categories.gibtsNichtMehr).toBeUndefined();
    expect(settings.irgendwasFremdes).toBeUndefined();
  });

  test('ergänzt neue Kategorien mit ihrem Standardwert', () => {
    const settings = normalizeSettings({ categories: { ads: { enabled: true } } });
    // `malware` gibt es erst seit v5 und muss trotzdem vorhanden sein.
    expect(settings.categories.malware).toBeDefined();
    expect(settings.categories.malware.enabled).toBe(true);
  });
});

describe('normalizeWhitelist', () => {
  test('normalisiert, dedupliziert und sortiert', () => {
    expect(normalizeWhitelist(['https://B.com/x', 'b.com', 'A.com'])).toEqual(['a.com', 'b.com']);
  });

  test('verwirft ungültige Einträge', () => {
    expect(normalizeWhitelist(['gueltig.test', '', 'kein host', 42, null])).toEqual([
      'gueltig.test',
    ]);
  });

  test('verwirft Nicht-Arrays', () => {
    expect(normalizeWhitelist('example.com')).toEqual([]);
  });
});

describe('normalizeCustomRules', () => {
  test('akzeptiert sowohl Strings als auch Objekte (v4-Kompatibilität)', () => {
    expect(normalizeCustomRules(['||a.test^', { urlFilter: '||b.test^' }])).toEqual([
      { urlFilter: '||a.test^' },
      { urlFilter: '||b.test^' },
    ]);
  });

  test('entfernt Duplikate und zu lange Muster', () => {
    const zuLang = 'a'.repeat(LIMITS.URL_FILTER_LENGTH + 1);
    expect(normalizeCustomRules(['||a.test^', '||a.test^', zuLang])).toEqual([
      { urlFilter: '||a.test^' },
    ]);
  });
});

describe('normalizeElementRules', () => {
  test('behält gültige Regeln', () => {
    const rules = normalizeElementRules([
      { selector: '.banner', siteOnly: false, createdAt: 1 },
      { selector: '.box', siteOnly: true, domain: 'example.com', createdAt: 2 },
    ]);
    expect(rules).toHaveLength(2);
    expect(rules[1].domain).toBe('example.com');
  });

  test('verwirft seitenspezifische Regeln ohne gültige Domain', () => {
    expect(
      normalizeElementRules([{ selector: '.x', siteOnly: true, domain: 'kein host' }])
    ).toEqual([]);
  });

  test('dedupliziert nach Selektor und Domain', () => {
    const rules = normalizeElementRules([
      { selector: '.x', siteOnly: false },
      { selector: '.x', siteOnly: false },
      { selector: '.x', siteOnly: true, domain: 'a.test' },
    ]);
    expect(rules).toHaveLength(2);
  });
});

describe('applyProtectionLevel', () => {
  test('schaltet Kategorien gemäß Stufe', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 25);
    expect(settings.protectionLevel).toBe(25);
    expect(settings.categories.ads.enabled).toBe(true);
    expect(settings.categories.analytics.enabled).toBe(false);
    expect(settings.categories.oem.enabled).toBe(false);
  });

  test('Stufe 0 schaltet alles ab, Stufe 100 alles an', () => {
    const aus = applyProtectionLevel(createDefaultSettings(), 0);
    expect(Object.values(aus.categories).every((c) => !c.enabled)).toBe(true);

    const max = applyProtectionLevel(createDefaultSettings(), 100);
    expect(Object.values(max.categories).every((c) => c.enabled)).toBe(true);
  });

  // Regression: v4 überschrieb das komplette categories-Objekt mit {enabled}
  // und löschte damit jede Feineinstellung des Nutzers.
  test('lässt Unterkategorie-Einstellungen unangetastet', () => {
    let settings = createDefaultSettings();
    settings = setSubcategoryEnabled(settings, 'analytics', 'error_tracking', true);
    settings = setSubcategoryEnabled(settings, 'ads', 'native', false);

    const nachher = applyProtectionLevel(settings, 100);

    expect(nachher.categories.analytics.subcategories.error_tracking.enabled).toBe(true);
    expect(nachher.categories.ads.subcategories.native.enabled).toBe(false);
  });

  test('ignoriert unbekannte Stufen', () => {
    const original = createDefaultSettings();
    expect(applyProtectionLevel(original, 42)).toBe(original);
  });

  test('verändert das Original nicht', () => {
    const original = createDefaultSettings();
    const kopie = JSON.stringify(original);
    applyProtectionLevel(original, 0);
    expect(JSON.stringify(original)).toBe(kopie);
  });
});

describe('Kategorie-Schalter', () => {
  test('setCategoryEnabled ändert nur die Zielkategorie', () => {
    const settings = setCategoryEnabled(createDefaultSettings(), 'ads', false);
    expect(settings.categories.ads.enabled).toBe(false);
    expect(settings.categories.analytics.enabled).toBe(true);
  });

  test('unbekannte IDs bleiben wirkungslos', () => {
    const original = createDefaultSettings();
    expect(setCategoryEnabled(original, 'gibtsNicht', false)).toBe(original);
    expect(setSubcategoryEnabled(original, 'ads', 'gibtsNicht', false)).toBe(original);
  });
});

describe('Whitelist', () => {
  test('fügt normalisiert hinzu', () => {
    const { settings, added } = addToWhitelist(createDefaultSettings(), 'https://Example.com/pfad');
    expect(added).toBe('example.com');
    expect(settings.whitelist).toEqual(['example.com']);
  });

  test('lehnt Duplikate und Unsinn ab', () => {
    const { settings } = addToWhitelist(createDefaultSettings(), 'example.com');
    expect(addToWhitelist(settings, 'example.com').added).toBeNull();
    expect(addToWhitelist(settings, 'kein host').added).toBeNull();
  });

  test('entfernt Einträge', () => {
    const { settings } = addToWhitelist(createDefaultSettings(), 'example.com');
    expect(removeFromWhitelist(settings, 'https://example.com').whitelist).toEqual([]);
  });

  test('Entfernen eines nicht vorhandenen Eintrags ist wirkungslos', () => {
    const original = createDefaultSettings();
    expect(removeFromWhitelist(original, 'example.com')).toBe(original);
  });
});

describe('Eigene Regeln', () => {
  test('hinzufügen und entfernen', () => {
    const { settings, added } = addCustomRule(createDefaultSettings(), '||werbung.test^');
    expect(added).toBe(true);
    expect(settings.customRules).toHaveLength(1);
    expect(removeCustomRule(settings, 0).customRules).toHaveLength(0);
  });

  test('lehnt Duplikate und Leerstrings ab', () => {
    const { settings } = addCustomRule(createDefaultSettings(), '||a.test^');
    expect(addCustomRule(settings, '||a.test^').added).toBe(false);
    expect(addCustomRule(settings, '   ').added).toBe(false);
  });

  test('ungültiger Index bleibt wirkungslos', () => {
    const original = createDefaultSettings();
    expect(removeCustomRule(original, -1)).toBe(original);
    expect(removeCustomRule(original, 99)).toBe(original);
  });
});

describe('Element-Regeln', () => {
  test('hinzufügen, rückgängig machen, löschen', () => {
    const erste = addElementRule(createDefaultSettings(), { selector: '.a' }, 1000);
    expect(erste.added?.selector).toBe('.a');

    const zweite = addElementRule(erste.settings, { selector: '.b' }, 2000);
    expect(zweite.settings.elementRules).toHaveLength(2);

    const rueckgaengig = undoLastElementRule(zweite.settings);
    expect(rueckgaengig.removed?.selector).toBe('.b');
    expect(rueckgaengig.settings.elementRules).toHaveLength(1);

    expect(clearElementRules(rueckgaengig.settings).elementRules).toHaveLength(0);
  });

  test('Rückgängig auf leerer Liste liefert null', () => {
    expect(undoLastElementRule(createDefaultSettings()).removed).toBeNull();
  });

  test('Entfernen über Index', () => {
    const { settings } = addElementRule(createDefaultSettings(), { selector: '.a' });
    const ergebnis = removeElementRule(settings, 0);
    expect(ergebnis.removed?.selector).toBe('.a');
    expect(ergebnis.settings.elementRules).toHaveLength(0);
  });

  test('getElementRulesForHost respektiert siteOnly', () => {
    let settings = createDefaultSettings();
    settings = addElementRule(settings, { selector: '.global' }).settings;
    settings = addElementRule(settings, {
      selector: '.lokal',
      siteOnly: true,
      domain: 'example.com',
    }).settings;

    expect(getElementRulesForHost(settings, 'example.com')).toHaveLength(2);
    expect(getElementRulesForHost(settings, 'shop.example.com')).toHaveLength(2);
    expect(getElementRulesForHost(settings, 'andere.test')).toHaveLength(1);
    expect(getElementRulesForHost(settings, null)).toHaveLength(1);
  });
});

describe('Export und Import', () => {
  test('Export enthält Metadaten und lässt sich wieder einlesen', () => {
    let settings = createDefaultSettings();
    settings = addToWhitelist(settings, 'example.com').settings;

    const json = exportSettings(settings, '5.0.0', new Date('2026-09-11T10:00:00Z'));
    const parsed = JSON.parse(json);
    expect(parsed._meta.app).toBe('pBlock');
    expect(parsed._meta.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);

    const wieder = importSettings(json);
    expect(wieder.ok).toBe(true);
    expect(wieder.ok && wieder.settings.whitelist).toEqual(['example.com']);
  });

  test('meldet fehlerhaftes JSON verständlich', () => {
    expect(importSettings('{kaputt')).toEqual({
      ok: false,
      error: 'Die Datei enthält kein gültiges JSON.',
    });
    expect(importSettings('')).toEqual({ ok: false, error: 'Die Datei ist leer.' });
    expect(importSettings('[1,2,3]').ok).toBe(false);
  });

  // Regression: v4 gab den JSON-Inhalt ungeprüft an chrome.storage.sync.set weiter.
  test('schleust keine unbekannten Schlüssel in die Einstellungen', () => {
    const ergebnis = importSettings(
      JSON.stringify({ masterEnabled: false, boesartig: { evil: true } })
    );
    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.ok && ergebnis.settings.boesartig).toBeUndefined();
    expect(ergebnis.ok && ergebnis.settings.masterEnabled).toBe(false);
  });
});

describe('migrateLegacySettings', () => {
  test('übersetzt v4-Feldnamen', () => {
    const migriert = migrateLegacySettings({
      filterLevel: 'expert',
      sliderValue: 75,
      settings: { showBadge: false, showNotifications: true },
    });
    expect(migriert.uiMode).toBe('expert');
    expect(migriert.protectionLevel).toBe(75);
    expect(migriert.ui).toEqual({ showBadge: false, showNotifications: true });
    expect(migriert.filterLevel).toBeUndefined();
    expect(migriert.sliderValue).toBeUndefined();
  });

  test('überführt customCosmeticRules in Element-Regeln', () => {
    const migriert = migrateLegacySettings({ customCosmeticRules: ['.alt-banner'] });
    expect(migriert.elementRules).toHaveLength(1);
    expect(migriert.elementRules[0].selector).toBe('.alt-banner');
    expect(migriert.customCosmeticRules).toBeUndefined();
  });

  test('lässt aktuelles Schema unverändert', () => {
    const aktuell = { schemaVersion: SETTINGS_SCHEMA_VERSION, masterEnabled: false };
    expect(migrateLegacySettings(aktuell)).toBe(aktuell);
  });

  test('eine komplette v4-Migration behält die Nutzerdaten', () => {
    const v4 = {
      masterEnabled: true,
      filterLevel: 'expert',
      sliderValue: 75,
      whitelist: ['example.com', 'https://zweite.test/'],
      customRules: ['||werbung.test^'],
      categories: { ads: { enabled: false, subcategories: { google: { enabled: false } } } },
      statistics: { today: 999 },
    };
    const settings = normalizeSettings(migrateLegacySettings(v4));

    expect(settings.uiMode).toBe('expert');
    expect(settings.protectionLevel).toBe(75);
    expect(settings.whitelist).toEqual(['example.com', 'zweite.test']);
    expect(settings.customRules).toEqual([{ urlFilter: '||werbung.test^' }]);
    expect(settings.categories.ads.enabled).toBe(false);
    expect(settings.statistics).toBeUndefined();
  });
});
