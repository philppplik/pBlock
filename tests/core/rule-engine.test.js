import { describe, expect, test } from 'vitest';
import {
  assignPresetRuleIds,
  buildAllowRules,
  buildCategoryRules,
  buildCustomRules,
  buildDynamicRuleSet,
  chunk,
  collectActiveFilters,
  computeRuleUpdate,
  isSameRule,
} from '../../src/core/rule-engine.js';
import {
  applyProtectionLevel,
  addCustomRule,
  addToWhitelist,
  setSubcategoryEnabled,
} from '../../src/core/settings.js';
import { createDefaultSettings } from '../../src/core/settings-schema.js';
import { RULE_ID_RANGES, RULE_PRIORITY } from '../../src/core/constants.js';

describe('chunk', () => {
  test('teilt in Blöcke fester Größe', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('leeres Array bleibt leer', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe('buildAllowRules', () => {
  test('erzeugt keine Regeln ohne Whitelist', () => {
    expect(buildAllowRules([])).toEqual([]);
    expect(buildAllowRules(null)).toEqual([]);
  });

  test('erzeugt allowAllRequests plus Initiator-Allow', () => {
    const rules = buildAllowRules(['example.com']);
    expect(rules).toHaveLength(2);
    expect(rules[0].action.type).toBe('allowAllRequests');
    expect(rules[0].condition.requestDomains).toEqual(['example.com']);
    expect(rules[1].action.type).toBe('allow');
    expect(rules[1].condition.initiatorDomains).toEqual(['example.com']);
  });

  test('nutzt die höchste Priorität, damit Block-Regeln verlieren', () => {
    for (const rule of buildAllowRules(['example.com'])) {
      expect(rule.priority).toBe(RULE_PRIORITY.ALLOW);
      expect(rule.priority).toBeGreaterThan(RULE_PRIORITY.CUSTOM);
      expect(rule.priority).toBeGreaterThan(RULE_PRIORITY.STATIC);
    }
  });

  test('bleibt im vorgesehenen ID-Bereich', () => {
    for (const rule of buildAllowRules(['a.test', 'b.test', 'c.test'])) {
      expect(rule.id).toBeGreaterThanOrEqual(RULE_ID_RANGES.ALLOW.start);
      expect(rule.id).toBeLessThanOrEqual(RULE_ID_RANGES.ALLOW.end);
    }
  });

  test('entfernt redundante Subdomains', () => {
    const rules = buildAllowRules(['example.com', 'shop.example.com', 'andere.test']);
    expect(rules[0].condition.requestDomains).toEqual(['andere.test', 'example.com']);
  });
});

describe('collectActiveFilters', () => {
  test('berücksichtigt nur aktive Kategorien', () => {
    const nurWerbung = applyProtectionLevel(createDefaultSettings(), 25);
    const { activeSubcategories } = collectActiveFilters(nurWerbung);
    expect(activeSubcategories.some((id) => id.startsWith('ads.'))).toBe(true);
    expect(activeSubcategories.some((id) => id.startsWith('analytics.'))).toBe(false);
  });

  test('berücksichtigt abgeschaltete Unterkategorien', () => {
    const settings = setSubcategoryEnabled(createDefaultSettings(), 'ads', 'native', false);
    const { activeSubcategories } = collectActiveFilters(settings);
    expect(activeSubcategories).not.toContain('ads.native');
    expect(activeSubcategories).toContain('ads.google');
  });

  test('liefert eine redundanzfreie Domainliste', () => {
    const { domains } = collectActiveFilters(applyProtectionLevel(createDefaultSettings(), 100));
    expect(new Set(domains).size).toBe(domains.length);
    // Keine Domain darf durch eine andere aus derselben Liste abgedeckt sein.
    for (const domain of domains) {
      const abgedeckt = domains.filter((other) => other !== domain && domain.endsWith(`.${other}`));
      expect(abgedeckt).toEqual([]);
    }
  });
});

describe('buildCategoryRules', () => {
  // Das ist der eigentliche Effizienzgewinn: v4 erzeugte ~200 Einzelregeln.
  test('fasst viele Domains zu wenigen Regeln zusammen', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const { domains } = collectActiveFilters(settings);
    const rules = buildCategoryRules(settings);

    expect(domains.length).toBeGreaterThan(100);
    expect(rules.length).toBeLessThan(20);
  });

  test('erzeugt ohne aktive Kategorie keine Regeln', () => {
    expect(buildCategoryRules(applyProtectionLevel(createDefaultSettings(), 0))).toEqual([]);
  });

  test('bleibt im vorgesehenen ID-Bereich', () => {
    for (const rule of buildCategoryRules(applyProtectionLevel(createDefaultSettings(), 100))) {
      expect(rule.id).toBeGreaterThanOrEqual(RULE_ID_RANGES.CATEGORY.start);
      expect(rule.id).toBeLessThanOrEqual(RULE_ID_RANGES.CATEGORY.end);
    }
  });

  test('blockiert kein main_frame — Navigationen bleiben möglich', () => {
    for (const rule of buildCategoryRules(applyProtectionLevel(createDefaultSettings(), 100))) {
      expect(rule.condition.resourceTypes).not.toContain('main_frame');
    }
  });
});

describe('buildCustomRules', () => {
  test('erzeugt eine Regel je Filter', () => {
    let settings = createDefaultSettings();
    settings = addCustomRule(settings, '||a.test^').settings;
    settings = addCustomRule(settings, '||b.test^').settings;

    const rules = buildCustomRules(settings);
    expect(rules).toHaveLength(2);
    expect(rules[0].condition.urlFilter).toBe('||a.test^');
    expect(rules[0].priority).toBe(RULE_PRIORITY.CUSTOM);
  });

  test('bleibt im vorgesehenen ID-Bereich', () => {
    const settings = addCustomRule(createDefaultSettings(), '||a.test^').settings;
    const [rule] = buildCustomRules(settings);
    expect(rule.id).toBe(RULE_ID_RANGES.CUSTOM.start);
  });
});

describe('assignPresetRuleIds', () => {
  const roh = [
    { priority: 1, action: { type: 'block' }, condition: { urlFilter: '||a.test^' } },
    { priority: 1, action: { type: 'block' }, condition: { urlFilter: '||b.test^' } },
  ];

  test('vergibt fortlaufende IDs im Preset-Bereich', () => {
    const rules = assignPresetRuleIds(roh, 10);
    expect(rules[0].id).toBe(RULE_ID_RANGES.PRESET.start);
    expect(rules[1].id).toBe(RULE_ID_RANGES.PRESET.start + 1);
  });

  test('respektiert das Budget', () => {
    expect(assignPresetRuleIds(roh, 1)).toHaveLength(1);
    expect(assignPresetRuleIds(roh, 0)).toHaveLength(0);
    expect(assignPresetRuleIds(roh, -5)).toHaveLength(0);
  });
});

describe('buildDynamicRuleSet', () => {
  test('liefert bei ausgeschaltetem Hauptschalter keine Regeln', () => {
    const settings = { ...createDefaultSettings(), masterEnabled: false };
    const ergebnis = buildDynamicRuleSet({ settings, presetRules: [{}, {}] });
    expect(ergebnis.rules).toEqual([]);
    expect(ergebnis.counts.total).toBe(0);
    expect(ergebnis.truncatedPresetRules).toBe(2);
  });

  test('vergibt eindeutige IDs über alle Quellen hinweg', () => {
    let settings = applyProtectionLevel(createDefaultSettings(), 100);
    settings = addToWhitelist(settings, 'example.com').settings;
    settings = addCustomRule(settings, '||eigen.test^').settings;

    const presetRules = Array.from({ length: 50 }, (_, i) => ({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `||p${i}.test^` },
    }));

    const { rules } = buildDynamicRuleSet({ settings, presetRules });
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Regression: v4 konnte bis zu 50.000 dynamische Regeln erzeugen. Chrome
  // garantiert 5.000 — der Aufruf scheiterte und ALLE Regeln gingen verloren.
  test('kürzt Listenregeln statt das Limit zu überschreiten', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const presetRules = Array.from({ length: 10_000 }, (_, i) => ({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `||p${i}.test^` },
    }));

    const ergebnis = buildDynamicRuleSet({ settings, presetRules, maxRules: 100 });
    expect(ergebnis.rules.length).toBeLessThanOrEqual(100);
    expect(ergebnis.truncatedPresetRules).toBeGreaterThan(0);
  });

  test('opfert niemals Whitelist oder eigene Regeln', () => {
    let settings = applyProtectionLevel(createDefaultSettings(), 100);
    settings = addToWhitelist(settings, 'example.com').settings;
    settings = addCustomRule(settings, '||eigen.test^').settings;

    const presetRules = Array.from({ length: 1000 }, () => ({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||p.test^' },
    }));

    // Das Budget wird exakt so knapp gewählt, dass für Listenregeln nichts
    // übrig bleibt. Whitelist, eigene Regeln und Kategorien müssen trotzdem
    // vollständig durchkommen — notfalls über das Limit hinaus, weil ein
    // stillschweigend aufgehobener Whitelist-Eintrag schlimmer wäre als eine
    // Regel zu viel.
    const ohneBudget = buildDynamicRuleSet({ settings, presetRules, maxRules: 1 });
    expect(ohneBudget.counts.allow).toBeGreaterThan(0);
    expect(ohneBudget.counts.custom).toBe(1);
    expect(ohneBudget.counts.category).toBeGreaterThan(0);
    expect(ohneBudget.counts.preset).toBe(0);
    expect(ohneBudget.truncatedPresetRules).toBe(1000);
  });

  test('füllt das verbleibende Budget mit Listenregeln auf', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const presetRules = Array.from({ length: 1000 }, () => ({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||p.test^' },
    }));

    const ergebnis = buildDynamicRuleSet({ settings, presetRules, maxRules: 25 });
    expect(ergebnis.counts.total).toBe(25);
    expect(ergebnis.counts.preset).toBe(25 - ergebnis.counts.category - ergebnis.counts.custom);
    expect(ergebnis.truncatedPresetRules).toBe(1000 - ergebnis.counts.preset);
  });
});

describe('computeRuleUpdate', () => {
  const regelA = {
    id: 1,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: '||a.test^' },
  };
  const regelB = {
    id: 2,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: '||b.test^' },
  };

  // Regression: v4 löschte bei jeder Änderung alle Regeln und schrieb sie neu —
  // inklusive eines Zeitfensters ohne jeden Schutz.
  test('meldet Gleichheit, wenn sich nichts geändert hat', () => {
    const ergebnis = computeRuleUpdate([regelA, regelB], [regelA, regelB]);
    expect(ergebnis.unchanged).toBe(true);
    expect(ergebnis.addRules).toEqual([]);
    expect(ergebnis.removeRuleIds).toEqual([]);
  });

  test('erkennt Gleichheit unabhängig von der Schlüsselreihenfolge', () => {
    const gedreht = {
      condition: { urlFilter: '||a.test^' },
      action: { type: 'block' },
      priority: 1,
      id: 1,
    };
    expect(computeRuleUpdate([regelA], [gedreht]).unchanged).toBe(true);
  });

  test('erkennt Gleichheit unabhängig von der Array-Reihenfolge', () => {
    const eins = {
      id: 1,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: ['a', 'b'] },
    };
    const zwei = {
      id: 1,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: ['b', 'a'] },
    };
    expect(isSameRule(eins, zwei)).toBe(true);
  });

  test('schreibt nur den Unterschied', () => {
    const geaendert = { ...regelB, condition: { urlFilter: '||neu.test^' } };
    const ergebnis = computeRuleUpdate([regelA, regelB], [regelA, geaendert]);
    expect(ergebnis.removeRuleIds).toEqual([2]);
    expect(ergebnis.addRules).toEqual([geaendert]);
  });

  test('entfernt weggefallene Regeln', () => {
    const ergebnis = computeRuleUpdate([regelA, regelB], [regelA]);
    expect(ergebnis.removeRuleIds).toEqual([2]);
    expect(ergebnis.addRules).toEqual([]);
  });
});
