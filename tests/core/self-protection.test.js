/**
 * Tests für den Selbstschutz der Erweiterung.
 *
 * Diese Datei existiert wegen eines konkreten Ausfalls in v5.0.0: Eine aus
 * EasyList Germany erzeugte Regel blockierte jede HTTPS-Anfrage — auch den
 * Download der Liste, die sie entfernt hätte. Die Erweiterung konnte sich nicht
 * mehr selbst reparieren.
 *
 * Die Tests hier sichern die Verteidigungslinien, die genau das verhindern.
 */

import { describe, expect, test } from 'vitest';
import {
  buildDynamicRuleSet,
  buildSelfProtectionRules,
  computeRuleUpdate,
} from '../../src/core/rule-engine.js';
import {
  buildRulesFromParsedList,
  findSelfBlockingRules,
  parseFilterList,
} from '../../src/core/filter-parser.js';
import { PRESETS, PRESET_SOURCE_HOSTS, PRESET_SOURCE_URLS } from '../../src/core/presets.js';
import { applyProtectionLevel, addToWhitelist } from '../../src/core/settings.js';
import { createDefaultSettings } from '../../src/core/settings-schema.js';
import { RULE_ID_RANGES, RULE_PRIORITY } from '../../src/core/constants.js';

describe('buildSelfProtectionRules', () => {
  test('deckt jeden Quell-Host der Filterlisten ab', () => {
    const rules = buildSelfProtectionRules();
    const abgedeckt = rules.flatMap((rule) => rule.condition.requestDomains);

    for (const host of PRESET_SOURCE_HOSTS) {
      const gedeckt = abgedeckt.some((domain) => host === domain || host.endsWith(`.${domain}`));
      expect(gedeckt, `${host} ist nicht geschützt`).toBe(true);
    }
  });

  test('sind Allow-Regeln mit der höchsten Priorität', () => {
    for (const rule of buildSelfProtectionRules()) {
      expect(rule.action.type).toBe('allow');
      expect(rule.priority).toBe(RULE_PRIORITY.SELF_PROTECTION);
      expect(rule.priority).toBeGreaterThan(RULE_PRIORITY.ALLOW);
      expect(rule.priority).toBeGreaterThan(RULE_PRIORITY.PRESET);
    }
  });

  test('schließen das Hauptdokument ein', () => {
    // Der Nutzer soll die Listen auch im Browser aufrufen können.
    for (const rule of buildSelfProtectionRules()) {
      expect(rule.condition.resourceTypes).toContain('main_frame');
    }
  });

  test('bleiben im vorgesehenen ID-Bereich', () => {
    for (const rule of buildSelfProtectionRules()) {
      expect(rule.id).toBeGreaterThanOrEqual(RULE_ID_RANGES.SELF_PROTECTION.start);
      expect(rule.id).toBeLessThanOrEqual(RULE_ID_RANGES.SELF_PROTECTION.end);
    }
  });

  test('überschneiden sich nicht mit anderen ID-Bereichen', () => {
    const ids = buildSelfProtectionRules().map((rule) => rule.id);
    for (const id of ids) {
      expect(id).toBeLessThan(RULE_ID_RANGES.ALLOW.start);
    }
  });
});

describe('Der Regelsatz insgesamt', () => {
  test('enthält die Schutzregeln bei jeder Schutzstufe', () => {
    for (const level of [0, 25, 50, 75, 100]) {
      const settings = applyProtectionLevel(createDefaultSettings(), level);
      const { counts } = buildDynamicRuleSet({ settings });
      expect(counts.selfProtection, `Stufe ${level}`).toBeGreaterThan(0);
    }
  });

  test('lässt die Schutzregeln auch bei knappem Kontingent stehen', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const presetRules = Array.from({ length: 5_000 }, () => ({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||p.test^' },
    }));

    const ergebnis = buildDynamicRuleSet({ settings, presetRules, maxRules: 1 });
    expect(ergebnis.counts.selfProtection).toBeGreaterThan(0);
    expect(ergebnis.counts.preset).toBe(0);
  });

  test('vergibt weiterhin eindeutige IDs', () => {
    let settings = applyProtectionLevel(createDefaultSettings(), 100);
    settings = addToWhitelist(settings, 'example.com').settings;

    const { rules } = buildDynamicRuleSet({
      settings,
      presetRules: Array.from({ length: 20 }, (_, i) => ({
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: `||p${i}.test^` },
      })),
    });

    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('die Differenzberechnung kommt mit den Schutzregeln zurecht', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 50);
    const erster = buildDynamicRuleSet({ settings });
    const zweiter = buildDynamicRuleSet({ settings });
    expect(computeRuleUpdate(erster.rules, zweiter.rules).unchanged).toBe(true);
  });
});

describe('Kein mitgelieferter Filter blockiert eine eigene Quelle', () => {
  test('bei maximaler Schutzstufe', () => {
    const settings = applyProtectionLevel(createDefaultSettings(), 100);
    const { rules } = buildDynamicRuleSet({ settings });

    // Nur die Block-Regeln prüfen; die Allow-Regeln dürfen und sollen treffen.
    const blockRules = rules.filter((rule) => rule.action.type === 'block');
    expect(findSelfBlockingRules(blockRules, PRESET_SOURCE_URLS)).toEqual([]);
  });
});

describe('Eine Liste mit der Unglückszeile bleibt unschädlich', () => {
  // Nachbau der Situation, die v5.0.0 lahmgelegt hat.
  const LISTE = [
    '! Testliste',
    '|https:$domain=adfarm1.adition.com',
    '|http://$subdocument,third-party,domain=bonimail.de',
    '|https:',
    '||werbung.test^',
  ].join('\n');

  test('die globale Variante wird verworfen, die eingegrenzte bleibt', () => {
    const parsed = parseFilterList(LISTE);
    const ungebunden = parsed.patterns.filter(
      (pattern) => !pattern.initiatorDomains || pattern.initiatorDomains.length === 0
    );

    expect(parsed.stats.reasons['muster-zu-breit']).toBe(1);
    expect(ungebunden).toEqual([]);
    expect(parsed.patterns.length).toBe(2);
  });

  test('keine erzeugte Regel trifft eine unverzichtbare Adresse', () => {
    const rules = buildRulesFromParsedList(parseFilterList(LISTE));
    const kanarienvoegel = [
      ...PRESET_SOURCE_URLS,
      'https://www.google.com/',
      'https://github.com/',
    ];
    expect(findSelfBlockingRules(rules, kanarienvoegel)).toEqual([]);
  });

  test('selbst wenn eine Regel durchrutscht, bleiben die Quellen erreichbar', () => {
    // Der Fall, gegen den die Schutzregeln absichern: eine bösartig breite
    // Regel, die alle vorherigen Prüfungen umgangen hat.
    const boese = {
      id: 99_999,
      priority: RULE_PRIORITY.PRESET,
      action: { type: 'block' },
      condition: { urlFilter: '|https:', resourceTypes: ['xmlhttprequest'] },
    };

    const schutz = buildSelfProtectionRules();
    // Die Schutzregel muss die bösartige schlagen.
    expect(schutz[0].priority).toBeGreaterThan(boese.priority);
    expect(schutz[0].action.type).toBe('allow');
  });
});

describe('Alle Quellen sind erreichbare HTTPS-Adressen', () => {
  test('jede Liste nennt ihre Quellen vollständig', () => {
    const ausDefinitionen = Object.values(PRESETS).flatMap((preset) => preset.urls);
    expect([...PRESET_SOURCE_URLS].sort()).toEqual(ausDefinitionen.sort());
  });
});
