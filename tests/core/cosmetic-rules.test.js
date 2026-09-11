import { describe, expect, test } from 'vitest';
import {
  COSMETIC_SELECTORS,
  REMOVED_LEGACY_SELECTORS,
  buildStylesheet,
  hasBalancedBrackets,
  isStructurallyValidSelector,
  selectCosmeticSelectors,
} from '../../src/core/cosmetic-rules.js';
import { addElementRule, applyProtectionLevel } from '../../src/core/settings.js';
import { createDefaultSettings } from '../../src/core/settings-schema.js';

describe('selectCosmeticSelectors', () => {
  const basis = { hostname: 'beispiel.test', isWhitelisted: false };

  test('liefert Selektoren für aktive Kategorien', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const selektoren = selectCosmeticSelectors({ ...basis, settings });
    expect(selektoren).toContain('.adsbygoogle');
    expect(selektoren).toContain('.fb-like');
  });

  test('lässt Kategorien weg, die aus sind', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 25);
    const selektoren = selectCosmeticSelectors({ ...basis, settings });
    expect(selektoren).toContain('.adsbygoogle');
    expect(selektoren).not.toContain('.fb-like');
  });

  test('liefert nichts bei Whitelist, Hauptschalter aus oder deaktivierten Cosmetic-Filtern', () => {
    const settings = createDefaultSettings();
    expect(selectCosmeticSelectors({ ...basis, settings, isWhitelisted: true })).toEqual([]);
    expect(
      selectCosmeticSelectors({ ...basis, settings: { ...settings, masterEnabled: false } })
    ).toEqual([]);
    expect(
      selectCosmeticSelectors({
        ...basis,
        settings: { ...settings, cosmeticFiltersEnabled: false },
      })
    ).toEqual([]);
  });

  test('berücksichtigt globale Element-Regeln', () => {
    const settings = addElementRule(createDefaultSettings(), { selector: '.mein-banner' }).settings;
    expect(selectCosmeticSelectors({ ...basis, settings })).toContain('.mein-banner');
  });

  test('wendet seitenspezifische Regeln nur auf der passenden Domain an', () => {
    const settings = addElementRule(createDefaultSettings(), {
      selector: '.nur-hier',
      siteOnly: true,
      domain: 'beispiel.test',
    }).settings;

    expect(
      selectCosmeticSelectors({ settings, hostname: 'beispiel.test', isWhitelisted: false })
    ).toContain('.nur-hier');
    expect(
      selectCosmeticSelectors({ settings, hostname: 'sub.beispiel.test', isWhitelisted: false })
    ).toContain('.nur-hier');
    expect(
      selectCosmeticSelectors({ settings, hostname: 'andere.test', isWhitelisted: false })
    ).not.toContain('.nur-hier');
  });

  test('liefert keine Duplikate', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const selektoren = selectCosmeticSelectors({ ...basis, settings });
    expect(new Set(selektoren).size).toBe(selektoren.length);
  });
});

describe('buildStylesheet', () => {
  test('erzeugt eine Regel je Selektor', () => {
    const { css, used, rejected } = buildStylesheet(['.a', '#b']);
    expect(used).toEqual(['.a', '#b']);
    expect(rejected).toEqual([]);
    expect(css).toContain('.a{display:none!important');
    expect(css.split('\n')).toHaveLength(2);
  });

  // Regression: v4 fügte alle Selektoren zu EINER Regel zusammen und prüfte
  // Nutzereingaben aus dem Element-Picker nicht. Ein Tippfehler legte damit
  // sämtliche Cosmetic-Filter lahm.
  test('isoliert ungültige Selektoren, statt alles unwirksam zu machen', () => {
    const { css, used, rejected } = buildStylesheet(['.gut', '.kaputt{', '#auch-gut']);
    expect(used).toEqual(['.gut', '#auch-gut']);
    expect(rejected).toEqual(['.kaputt{']);
    expect(css).toContain('.gut');
    expect(css).toContain('#auch-gut');
    expect(css).not.toContain('.kaputt');
  });

  test('liefert leeres CSS ohne verwendbare Selektoren', () => {
    expect(buildStylesheet([]).css).toBe('');
    expect(buildStylesheet(['{']).css).toBe('');
  });

  test('akzeptiert eine eigene Prüffunktion', () => {
    const { used } = buildStylesheet(['.a', '.b'], { validate: (s) => s === '.a' });
    expect(used).toEqual(['.a']);
  });
});

describe('isStructurallyValidSelector', () => {
  test.each(['.banner', '#ad', 'div[data-ad-slot]', 'a[href^="https://"]', '.a > .b'])(
    'akzeptiert %s',
    (selector) => {
      expect(isStructurallyValidSelector(selector)).toBe(true);
    }
  );

  test.each([
    '.x{color:red}',
    '.x; color:red',
    '.x /* weg */',
    '@import url(evil)',
    '.x:has-text(Werbung)',
    'div[unfertig',
    '',
    '   ',
    null,
    'a'.repeat(501),
  ])('lehnt %s ab', (selector) => {
    expect(isStructurallyValidSelector(selector)).toBe(false);
  });
});

describe('hasBalancedBrackets', () => {
  test('erkennt ausgeglichene Klammern', () => {
    expect(hasBalancedBrackets('div[data-x="a"] > :not(.b)')).toBe(true);
  });

  test('erkennt unausgeglichene Klammern', () => {
    expect(hasBalancedBrackets('div[data-x')).toBe(false);
    expect(hasBalancedBrackets(':not(.b')).toBe(false);
    expect(hasBalancedBrackets('a]')).toBe(false);
  });

  test('ignoriert Klammern innerhalb von Anführungszeichen', () => {
    expect(hasBalancedBrackets('a[href="("]')).toBe(true);
  });
});

describe('Selektor-Katalog', () => {
  test('alle mitgelieferten Selektoren sind strukturell gültig', () => {
    for (const gruppe of Object.values(COSMETIC_SELECTORS)) {
      for (const selector of gruppe) {
        expect(isStructurallyValidSelector(selector), `ungültig: ${selector}`).toBe(true);
      }
    }
  });

  test('die aus v4 entfernten Selektoren sind nicht zurückgekehrt', () => {
    const alle = Object.values(COSMETIC_SELECTORS).flat();
    for (const entfernt of REMOVED_LEGACY_SELECTORS) {
      expect(alle, `${entfernt} wurde wegen Fehlalarmen entfernt`).not.toContain(entfernt);
    }
  });

  test('enthält keine Duplikate innerhalb einer Gruppe', () => {
    for (const [name, gruppe] of Object.entries(COSMETIC_SELECTORS)) {
      expect(new Set(gruppe).size, `Duplikat in ${name}`).toBe(gruppe.length);
    }
  });
});
