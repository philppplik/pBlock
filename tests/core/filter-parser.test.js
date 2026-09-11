import { describe, expect, test } from 'vitest';
import {
  buildRulesFromParsedList,
  checkOptions,
  isSafeCssSelector,
  isValidUrlFilter,
  parseFilterLine,
  parseFilterList,
} from '../../src/core/filter-parser.js';

describe('parseFilterLine — Domain-Blockaden', () => {
  test('erkennt ||domain^', () => {
    expect(parseFilterLine('||werbung.test^')).toEqual({
      ok: true,
      kind: 'block-domain',
      value: 'werbung.test',
    });
  });

  test('erkennt ||domain ohne Separator', () => {
    expect(parseFilterLine('||werbung.test')).toMatchObject({ kind: 'block-domain' });
  });

  test('erkennt nackte Domains', () => {
    expect(parseFilterLine('werbung.test')).toEqual({
      ok: true,
      kind: 'block-domain',
      value: 'werbung.test',
    });
  });

  test('erkennt das Hosts-Datei-Format', () => {
    expect(parseFilterLine('0.0.0.0 tracker.test')).toEqual({
      ok: true,
      kind: 'block-domain',
      value: 'tracker.test',
    });
    expect(parseFilterLine('127.0.0.1 localhost')).toMatchObject({ ok: false });
  });
});

describe('parseFilterLine — Ausnahmen', () => {
  // Regression: v4 verwarf jede @@-Zeile. Ausnahmen entschärfen Fehlalarme —
  // ohne sie blockiert man Logins und Bezahlvorgänge.
  test('übersetzt Domain-Ausnahmen in Allow-Einträge', () => {
    expect(parseFilterLine('@@||bank.test^')).toEqual({
      ok: true,
      kind: 'allow-domain',
      value: 'bank.test',
    });
  });

  test('verwirft Ausnahmen, die keine reine Domain sind', () => {
    expect(parseFilterLine('@@/pfad/zur/datei.js')).toMatchObject({ ok: false });
  });
});

describe('parseFilterLine — Options', () => {
  // Regression: v4 verwarf alles mit einem $ pauschal und verlor damit den
  // Großteil jeder echten Filterliste.
  test('akzeptiert Regeln mit unterstützten Options', () => {
    expect(parseFilterLine('||werbung.test^$third-party')).toMatchObject({ ok: true });
    expect(parseFilterLine('||werbung.test^$script,image')).toMatchObject({ ok: true });
    expect(parseFilterLine('||werbung.test^$domain=beispiel.test')).toMatchObject({ ok: true });
  });

  test('verwirft Regeln mit nicht abbildbaren Options', () => {
    expect(parseFilterLine('||a.test^$csp=script-src none')).toMatchObject({
      ok: false,
      reason: 'option-csp',
    });
    expect(parseFilterLine('||a.test^$removeparam=utm_source')).toMatchObject({ ok: false });
    expect(parseFilterLine('||a.test^$popup')).toMatchObject({ ok: false });
    expect(parseFilterLine('||a.test^$redirect=noop.js')).toMatchObject({ ok: false });
  });

  test('verwirft unbekannte Options, statt sie zu ignorieren', () => {
    expect(parseFilterLine('||a.test^$voellig-neu')).toMatchObject({
      ok: false,
      reason: 'option-unbekannt',
    });
  });
});

describe('parseFilterLine — Regexp', () => {
  // Regression: v4 ließ Regexp-Regeln teilweise als literalen urlFilter durch.
  // Chrome lehnt die ab und lässt damit den GESAMTEN Regel-Update-Aufruf scheitern.
  test('verwirft Regexp-Regeln', () => {
    expect(parseFilterLine('/banner\\d+\\.gif/')).toMatchObject({ ok: false, reason: 'regexp' });
    expect(parseFilterLine('/ad[0-9]+/$script')).toMatchObject({ ok: false, reason: 'regexp' });
  });
});

describe('parseFilterLine — Cosmetic', () => {
  test('übernimmt generische Verstecken-Regeln', () => {
    expect(parseFilterLine('##.werbebanner')).toEqual({
      ok: true,
      kind: 'cosmetic',
      value: '.werbebanner',
    });
  });

  test('verwirft domainspezifische Cosmetic-Regeln', () => {
    expect(parseFilterLine('beispiel.test##.banner')).toMatchObject({
      ok: false,
      reason: 'cosmetic-domainspezifisch',
    });
  });

  test('verwirft erweiterte Syntax', () => {
    expect(parseFilterLine('#@#.banner')).toMatchObject({ ok: false });
    expect(parseFilterLine('#?#.banner:has-text(Werbung)')).toMatchObject({ ok: false });
  });

  test('verwirft Selektoren, die aus dem Block ausbrechen würden', () => {
    expect(parseFilterLine('##.x{color:red}')).toMatchObject({
      ok: false,
      reason: 'cosmetic-unsicher',
    });
  });
});

describe('parseFilterList', () => {
  const liste = [
    '[Adblock Plus 2.0]',
    '! Kommentar',
    '',
    '||werbung.test^',
    '||tracker.test^$third-party',
    '@@||bank.test^',
    '##.anzeigen-box',
    '/regexp\\d+/',
    '||a.test^$csp=none',
    '0.0.0.0 hosts-tracker.test',
  ].join('\n');

  test('trennt die Ergebnisse nach Art', () => {
    const ergebnis = parseFilterList(liste);
    expect(ergebnis.domains).toContain('werbung.test');
    expect(ergebnis.domains).toContain('tracker.test');
    expect(ergebnis.domains).toContain('hosts-tracker.test');
    expect(ergebnis.allowDomains).toEqual(['bank.test']);
    expect(ergebnis.cosmeticSelectors).toEqual(['.anzeigen-box']);
  });

  test('zählt Verwerfungen mit Begründung', () => {
    const ergebnis = parseFilterList(liste);
    expect(ergebnis.stats.skipped).toBeGreaterThan(0);
    expect(ergebnis.stats.reasons.regexp).toBe(1);
    expect(ergebnis.stats.reasons['option-csp']).toBe(1);
  });

  test('respektiert die Obergrenze', () => {
    const gross = Array.from({ length: 500 }, (_, i) => `||d${i}.test^`).join('\n');
    const ergebnis = parseFilterList(gross, { maxEntries: 10 });
    expect(ergebnis.domains.length).toBeLessThanOrEqual(10);
    expect(ergebnis.stats.reasons['limit-erreicht']).toBeGreaterThan(0);
  });

  test('verträgt leere und ungültige Eingaben', () => {
    expect(parseFilterList('').domains).toEqual([]);
    expect(parseFilterList(null).domains).toEqual([]);
  });

  test('dedupliziert', () => {
    const ergebnis = parseFilterList('||a.test^\n||a.test^\na.test');
    expect(ergebnis.domains).toEqual(['a.test']);
  });
});

describe('checkOptions', () => {
  test('akzeptiert reine Einschränkungen', () => {
    expect(checkOptions('third-party,script,domain=a.test')).toEqual({ ok: true });
    expect(checkOptions('~third-party')).toEqual({ ok: true });
  });

  test('lehnt nicht abbildbare Options ab', () => {
    expect(checkOptions('csp=default-src').ok).toBe(false);
  });
});

describe('isValidUrlFilter', () => {
  test('akzeptiert normale Muster', () => {
    expect(isValidUrlFilter('||a.test^')).toBe(true);
    expect(isValidUrlFilter('/werbung/banner')).toBe(true);
  });

  test('lehnt Nicht-ASCII ab', () => {
    expect(isValidUrlFilter('||wörterbuch.test^')).toBe(false);
  });

  test('lehnt zu lange Muster ab', () => {
    expect(isValidUrlFilter('a'.repeat(2001))).toBe(false);
  });

  test('lehnt Pipes in der Mitte ab', () => {
    expect(isValidUrlFilter('||a.test|b.test^')).toBe(false);
  });
});

describe('isSafeCssSelector', () => {
  test('akzeptiert einfache Selektoren', () => {
    expect(isSafeCssSelector('.banner')).toBe(true);
    expect(isSafeCssSelector('div[data-ad-slot]')).toBe(true);
  });

  test('lehnt Ausbrüche und Erweiterungen ab', () => {
    expect(isSafeCssSelector('.x{color:red}')).toBe(false);
    expect(isSafeCssSelector('.x:has-text(Werbung)')).toBe(false);
    expect(isSafeCssSelector('.x /* kommentar */')).toBe(false);
    expect(isSafeCssSelector('')).toBe(false);
  });
});

describe('buildRulesFromParsedList', () => {
  test('fasst Domains zu requestDomains-Regeln zusammen', () => {
    const parsed = {
      domains: Array.from({ length: 1200 }, (_, i) => `d${i}.test`),
      urlFilters: ['/werbung/'],
      allowDomains: [],
      cosmeticSelectors: [],
      stats: { lines: 0, accepted: 0, skipped: 0, reasons: {} },
    };

    const rules = buildRulesFromParsedList(parsed, { chunkSize: 500 });
    // 1200 Domains → 3 Blöcke, plus eine urlFilter-Regel.
    expect(rules).toHaveLength(4);
    expect(rules[0].condition.requestDomains).toHaveLength(500);
    expect(rules[3].condition.urlFilter).toBe('/werbung/');
  });

  test('vergibt bewusst keine IDs — das macht die Rule-Engine', () => {
    const parsed = {
      domains: ['a.test'],
      urlFilters: [],
      allowDomains: [],
      cosmeticSelectors: [],
      stats: { lines: 0, accepted: 0, skipped: 0, reasons: {} },
    };
    expect(buildRulesFromParsedList(parsed)[0].id).toBeUndefined();
  });
});
