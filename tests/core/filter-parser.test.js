import { describe, expect, test } from 'vitest';
import {
  buildRulesFromParsedList,
  findSelfBlockingRules,
  isCatastrophicallyBroad,
  isSafeCssSelector,
  isValidUrlFilter,
  parseFilterLine,
  parseFilterList,
  parseOptions,
} from '../../src/core/filter-parser.js';
import { PRESET_SOURCE_URLS } from '../../src/core/presets.js';

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

describe('parseOptions', () => {
  test('übernimmt Ressourcentypen', () => {
    const result = parseOptions('script,image');
    expect(result.ok).toBe(true);
    expect(result.resourceTypes.sort()).toEqual(['image', 'script']);
  });

  test('lässt reine Einschränkungen weg', () => {
    const result = parseOptions('third-party,important,match-case');
    expect(result.ok).toBe(true);
    expect(result.resourceTypes).toBeNull();
    expect(result.initiatorDomains).toEqual([]);
  });

  // Regression: v5.0.0 behandelte `domain=` als weglassbare Einschränkung.
  // Aus `|https:$domain=adfarm1.adition.com` wurde dadurch `|https:` — eine
  // Regel, die jede HTTPS-Anfrage im gesamten Web blockierte.
  test('setzt domain= in initiatorDomains um, statt es wegzulassen', () => {
    const result = parseOptions('domain=a.test|b.test');
    expect(result.ok).toBe(true);
    expect(result.initiatorDomains).toEqual(['a.test', 'b.test']);
  });

  test('trennt eingeschlossene und ausgeschlossene Domains', () => {
    const result = parseOptions('domain=a.test|~b.test');
    expect(result.initiatorDomains).toEqual(['a.test']);
    expect(result.excludedInitiatorDomains).toEqual(['b.test']);
  });

  // Regression: URLhaus nutzt $all auf über 7.500 Zeilen. v5.0.0 verwarf sie
  // alle als unbekannte Option und verlor damit gut 80 % der Malware-Liste.
  test('kennt $all und markiert es', () => {
    const result = parseOptions('all');
    expect(result.ok).toBe(true);
    expect(result.isAll).toBe(true);
    expect(result.resourceTypes).toContain('main_frame');
  });

  test('lehnt nicht abbildbare Options ab', () => {
    expect(parseOptions('csp=default-src').ok).toBe(false);
    expect(parseOptions('removeparam=utm_source').ok).toBe(false);
    // `denyallow` verengt auf Ziel-Domains. Es wegzulassen würde die Regel
    // verbreitern — zu riskant.
    expect(parseOptions('denyallow=a.test').ok).toBe(false);
  });
});

describe('isCatastrophicallyBroad', () => {
  // Genau die Muster, die den Ausfall in v5.0.0 ausgelöst haben.
  test.each(['|https:', '|http:', '|https://', '|http://', '||', '*', '^'])(
    'erkennt %s als zu breit',
    (pattern) => {
      expect(isCatastrophicallyBroad(pattern)).toBe(true);
    }
  );

  test.each(['||werbung.test^', '/ezo/*', '||a.test^', '/banner-300x250.'])(
    'lässt %s durch',
    (pattern) => {
      expect(isCatastrophicallyBroad(pattern)).toBe(false);
    }
  );
});

describe('findSelfBlockingRules', () => {
  const canaries = ['https://easylist.to/easylist/easylist.txt', 'https://example.com/'];

  test('erkennt eine Regel, die alles blockiert', () => {
    const rules = [
      { action: { type: 'block' }, condition: { urlFilter: '|https:', resourceTypes: ['script'] } },
    ];
    const hits = findSelfBlockingRules(rules, canaries);
    expect(hits).toHaveLength(1);
  });

  test('erkennt eine Regel über requestDomains', () => {
    const rules = [{ action: { type: 'block' }, condition: { requestDomains: ['easylist.to'] } }];
    expect(findSelfBlockingRules(rules, canaries)).toHaveLength(1);
  });

  // Auf Domains eingegrenzte Regeln können unsere Downloads nicht treffen:
  // Die laufen ohne Dokument-Ursprung.
  test('ignoriert auf Domains eingegrenzte Regeln', () => {
    const rules = [
      {
        action: { type: 'block' },
        condition: { urlFilter: '|https:', initiatorDomains: ['adfarm1.adition.com'] },
      },
    ];
    expect(findSelfBlockingRules(rules, canaries)).toEqual([]);
  });

  test('lässt harmlose Regeln in Ruhe', () => {
    const rules = [{ action: { type: 'block' }, condition: { requestDomains: ['werbung.test'] } }];
    expect(findSelfBlockingRules(rules, canaries)).toEqual([]);
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
  /**
   * @param {Partial<import('../../src/core/filter-parser.js').ParsedFilterList>} overrides
   */
  function parsedList(overrides = {}) {
    return {
      domains: [],
      documentDomains: [],
      patterns: [],
      allowDomains: [],
      cosmeticSelectors: [],
      stats: { lines: 0, accepted: 0, skipped: 0, reasons: {} },
      ...overrides,
    };
  }

  test('fasst Domains zu requestDomains-Regeln zusammen', () => {
    const parsed = parsedList({
      domains: Array.from({ length: 1200 }, (_, i) => `d${i}.test`),
      patterns: [{ urlFilter: '/werbung/' }],
    });

    const rules = buildRulesFromParsedList(parsed, { chunkSize: 500 });
    // 1200 Domains → 3 Blöcke, plus eine Muster-Regel.
    expect(rules).toHaveLength(4);
    expect(rules[0].condition.requestDomains).toHaveLength(500);
    expect(rules[3].condition.urlFilter).toBe('/werbung/');
  });

  test('gibt $all-Domains zusätzlich main_frame mit', () => {
    const rules = buildRulesFromParsedList(parsedList({ documentDomains: ['schadsoftware.test'] }));
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.resourceTypes).toContain('main_frame');
  });

  test('reicht die Domain-Eingrenzung eines Musters durch', () => {
    const rules = buildRulesFromParsedList(
      parsedList({
        patterns: [
          {
            urlFilter: '|https:',
            initiatorDomains: ['adfarm1.adition.com'],
            excludedInitiatorDomains: ['gut.test'],
          },
        ],
      })
    );
    expect(rules[0].condition.initiatorDomains).toEqual(['adfarm1.adition.com']);
    expect(rules[0].condition.excludedInitiatorDomains).toEqual(['gut.test']);
  });

  test('vergibt bewusst keine IDs — das macht die Rule-Engine', () => {
    expect(buildRulesFromParsedList(parsedList({ domains: ['a.test'] }))[0].id).toBeUndefined();
  });
});

describe('Der Ausfall aus v5.0.0, Zeile für Zeile', () => {
  // Diese Zeile steht so in EasyList Germany und hat in v5.0.0 dazu geführt,
  // dass jede HTTPS-Anfrage blockiert wurde — einschließlich der Downloads,
  // mit denen sich die Erweiterung selbst hätte reparieren können.
  const UNGLUECKSZEILE = '|https:$domain=adfarm1.adition.com';

  test('erzeugt eine auf die Domain eingegrenzte Regel statt einer globalen', () => {
    const result = parseFilterLine(UNGLUECKSZEILE);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('block-pattern');
    expect(result.rule.urlFilter).toBe('|https:');
    expect(result.rule.initiatorDomains).toEqual(['adfarm1.adition.com']);
  });

  test('verwirft dasselbe Muster ohne Eingrenzung', () => {
    const result = parseFilterLine('|https:');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('muster-zu-breit');
  });

  test('die erzeugte Regel blockiert die eigenen Quellen nicht', () => {
    const parsed = parseFilterList(`${UNGLUECKSZEILE}\n||werbung.test^`);
    const rules = buildRulesFromParsedList(parsed);
    expect(findSelfBlockingRules(rules, PRESET_SOURCE_URLS)).toEqual([]);
  });

  test('eine ganze Liste mit der Zeile bleibt unschädlich', () => {
    const liste = [
      '! Titel: Testliste',
      '||werbung.test^',
      UNGLUECKSZEILE,
      '|http://$subdocument,third-party,domain=bonimail.de',
      '||tracker.test^$all',
      '@@||bank.test^',
    ].join('\n');

    const parsed = parseFilterList(liste);
    const rules = buildRulesFromParsedList(parsed);

    expect(parsed.domains).toContain('werbung.test');
    expect(parsed.documentDomains).toContain('tracker.test');
    expect(parsed.allowDomains).toContain('bank.test');
    expect(findSelfBlockingRules(rules, PRESET_SOURCE_URLS)).toEqual([]);
  });
});
