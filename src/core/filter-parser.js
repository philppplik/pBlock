/**
 * Parser für Filterlisten im Adblock-Plus-Format.
 *
 * ## Der Fehler, der diesen Parser in v5.1.0 neu geschrieben hat
 *
 * v5.0.0 behandelte `$domain=` als „harmlose Einschränkung, die entfallen darf“.
 * Die Begründung lautete: Lässt man eine Einschränkung weg, greift die Regel
 * höchstens breiter als gedacht, aber niemals falsch.
 *
 * Das ist für `$domain=` falsch. EasyList Germany enthält die Zeile
 *
 *     |https:$domain=adfarm1.adition.com
 *
 * Gemeint ist: „blockiere alles — aber nur auf dieser einen Seite“. Ohne das
 * `$domain=` bleibt `|https:` übrig. `|` ist der Anfangsanker, `https:` das
 * Präfix jeder HTTPS-Adresse: **eine Regel, die das gesamte Web blockiert.**
 *
 * Sie war zudem selbstverstärkend. Einmal angewendet, scheiterte auch der
 * Download der Liste, die sie entfernt hätte — ein Zustand, aus dem sich die
 * Erweiterung nicht mehr selbst befreien konnte.
 *
 * Drei Konsequenzen, die dieser Parser jetzt zieht:
 *
 * 1. `$domain=` wird **umgesetzt**, nicht weggelassen (siehe {@link parseDomainOption}).
 * 2. Muster ohne unterscheidungskräftigen Kern werden verworfen, wenn sie nicht
 *    auf Domains eingegrenzt sind (siehe {@link isCatastrophicallyBroad}).
 * 3. Zusätzlich prüft {@link findSelfBlockingRules} die fertigen Regeln gegen
 *    eine Liste von Adressen, die niemals blockiert werden dürfen.
 *
 * Die Prüfungen sind bewusst redundant. Der Schaden eines einzigen
 * durchgerutschten Musters ist zu groß für eine einzelne Verteidigungslinie.
 */

import { BLOCKABLE_RESOURCE_TYPES } from './constants.js';

/**
 * Options, die sich auf einen declarativeNetRequest-Ressourcentyp abbilden lassen.
 * @type {Readonly<Record<string, string>>}
 */
const OPTION_TO_RESOURCE_TYPE = Object.freeze({
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  document: 'main_frame',
  doc: 'main_frame',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  ping: 'ping',
  beacon: 'ping',
  other: 'other',
});

/**
 * Options, die keine Entsprechung haben und zum Verwerfen der Zeile führen.
 *
 * Sie stillschweigend zu ignorieren wäre schlimmer als die Regel wegzulassen:
 * `$csp` oder `$removeparam` beschreiben eine völlig andere Aktion als
 * „blockieren“.
 */
const UNSUPPORTED_OPTIONS = Object.freeze(
  new Set([
    'csp',
    'removeparam',
    'removeheader',
    'redirect',
    'redirect-rule',
    'replace',
    'popup',
    'popunder',
    'genericblock',
    'generichide',
    'ghide',
    'elemhide',
    'ehide',
    'specifichide',
    'shide',
    'inline-script',
    'inline-font',
    'empty',
    'mp4',
    'stealth',
    'cookie',
    'permissions',
    'urltransform',
    'uritransform',
    'header',
  ])
);

/**
 * Options, die die Regel lediglich verengen und deren Weglassen die Regel
 * höchstens etwas breiter macht — niemals global.
 *
 * `domain` steht hier bewusst **nicht** mehr drin; das war der Fehler in v5.0.0.
 */
const IGNORABLE_OPTIONS = Object.freeze(
  new Set([
    'third-party',
    '3p',
    'first-party',
    '1p',
    'important',
    'match-case',
    'strict3p',
    'strict1p',
  ])
);

/** Erkennt eine reine Domain-Blockade der Form `||example.com^`. */
const PURE_DOMAIN_PATTERN = /^\|\|([a-z0-9._-]+)\^?$/i;

/** Erkennt Zeilen im Hosts-Datei-Format, z. B. `0.0.0.0 tracker.example`. */
const HOSTS_LINE_PATTERN = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+([a-z0-9._-]+)\s*$/i;

/** Erkennt eine nackte Domain in einer Zeile. */
const BARE_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * @typedef {object} PatternRule
 * @property {string} urlFilter
 * @property {string[]} [initiatorDomains] Aus `$domain=`.
 * @property {string[]} [excludedInitiatorDomains] Aus `$domain=~…`.
 * @property {string[]} [resourceTypes] Aus Typ-Options, sonst der Standard.
 */

/**
 * @typedef {object} ParsedFilterList
 * @property {string[]} domains Domains, die vollständig blockiert werden.
 * @property {string[]} documentDomains Wie `domains`, zusätzlich das Hauptdokument (`$all`).
 * @property {PatternRule[]} patterns Muster, ggf. auf Domains eingegrenzt.
 * @property {string[]} allowDomains Domains aus Ausnahmeregeln.
 * @property {string[]} cosmeticSelectors Generische Cosmetic-Selektoren.
 * @property {{lines: number, accepted: number, skipped: number, reasons: Record<string, number>}} stats
 */

/**
 * Parst eine komplette Filterliste.
 *
 * @param {string} text Rohinhalt der Liste.
 * @param {object} [options]
 * @param {number} [options.maxEntries=60000]
 * @param {boolean} [options.includeCosmetic=true]
 * @returns {ParsedFilterList}
 */
export function parseFilterList(text, { maxEntries = 60_000, includeCosmetic = true } = {}) {
  /** @type {ParsedFilterList} */
  const result = {
    domains: [],
    documentDomains: [],
    patterns: [],
    allowDomains: [],
    cosmeticSelectors: [],
    stats: { lines: 0, accepted: 0, skipped: 0, reasons: {} },
  };

  if (typeof text !== 'string' || text.length === 0) return result;

  const domains = new Set();
  const documentDomains = new Set();
  const allowDomains = new Set();
  const cosmetic = new Set();
  /** @type {Map<string, PatternRule>} */
  const patterns = new Map();

  const skip = (reason) => {
    result.stats.skipped += 1;
    result.stats.reasons[reason] = (result.stats.reasons[reason] ?? 0) + 1;
  };

  for (const rawLine of text.split('\n')) {
    result.stats.lines += 1;
    if (domains.size + patterns.size >= maxEntries) {
      skip('limit-erreicht');
      continue;
    }

    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('!') || line.startsWith('#!') || line.startsWith('[')) continue;

    const parsed = parseFilterLine(line, { includeCosmetic });
    if (!parsed.ok) {
      skip(parsed.reason);
      continue;
    }

    result.stats.accepted += 1;
    switch (parsed.kind) {
      case 'block-domain':
        domains.add(parsed.value);
        break;
      case 'block-domain-all':
        documentDomains.add(parsed.value);
        break;
      case 'block-pattern': {
        // Über den vollständigen Regelinhalt deduplizieren, nicht nur über das
        // Muster: dasselbe Muster mit anderer Domain-Eingrenzung ist eine
        // andere Regel.
        const key = JSON.stringify(parsed.rule);
        if (!patterns.has(key)) patterns.set(key, parsed.rule);
        break;
      }
      case 'allow-domain':
        allowDomains.add(parsed.value);
        break;
      case 'cosmetic':
        cosmetic.add(parsed.value);
        break;
      default:
        break;
    }
  }

  result.domains = [...domains];
  // Was ohnehin für alle Typen blockiert wird, muss nicht zusätzlich im
  // engeren Topf stehen.
  result.documentDomains = [...documentDomains].filter((domain) => !domains.has(domain));
  result.patterns = [...patterns.values()];
  result.allowDomains = [...allowDomains];
  result.cosmeticSelectors = [...cosmetic];
  return result;
}

/**
 * Parst eine einzelne Zeile.
 *
 * @param {string} line Bereits getrimmt, nicht leer, kein Kommentar.
 * @param {{includeCosmetic?: boolean}} [options]
 * @returns {{ok: true, kind: 'block-domain'|'allow-domain'|'cosmetic', value: string}
 *   | {ok: true, kind: 'block-pattern', rule: PatternRule}
 *   | {ok: false, reason: string}}
 */
export function parseFilterLine(line, { includeCosmetic = true } = {}) {
  const cosmetic = parseCosmeticLine(line, includeCosmetic);
  if (cosmetic) return cosmetic;

  const hostsMatch = HOSTS_LINE_PATTERN.exec(line);
  if (hostsMatch) {
    const domain = hostsMatch[1].toLowerCase();
    if (domain === 'localhost' || domain === 'localhost.localdomain') {
      return { ok: false, reason: 'hosts-localhost' };
    }
    return { ok: true, kind: 'block-domain', value: domain };
  }

  if (BARE_DOMAIN_PATTERN.test(line)) {
    return { ok: true, kind: 'block-domain', value: line.toLowerCase() };
  }

  const isException = line.startsWith('@@');
  const body = isException ? line.slice(2) : line;

  // declarativeNetRequest kennt zwar `regexFilter`, aber mit anderer Syntax
  // (RE2) und strengen Längenlimits. Eine Fehlübersetzung lässt den gesamten
  // Regel-Update-Aufruf scheitern.
  if (body.startsWith('/') && /\/(\$.*)?$/.test(body)) {
    return { ok: false, reason: 'regexp' };
  }

  const optionIndex = body.lastIndexOf('$');
  const pattern = optionIndex === -1 ? body : body.slice(0, optionIndex);
  const optionString = optionIndex === -1 ? '' : body.slice(optionIndex + 1);

  const options = parseOptions(optionString);
  if (!options.ok) return options;

  if (pattern.length === 0) return { ok: false, reason: 'muster-leer' };

  const domainMatch = PURE_DOMAIN_PATTERN.exec(pattern);
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase().replace(/\.$/, '');

    const unscoped =
      options.initiatorDomains.length === 0 && options.excludedInitiatorDomains.length === 0;

    // Reine Domain-Blockaden werden zu Domain-Listen zusammengefasst — 500
    // Domains je Regel statt 500 Regeln. Zwei Töpfe, weil `$all` zusätzlich das
    // Hauptdokument einschließt und damit andere Ressourcentypen braucht.
    if (unscoped && options.resourceTypes === null) {
      return { ok: true, kind: isException ? 'allow-domain' : 'block-domain', value: domain };
    }
    if (unscoped && options.isAll && !isException) {
      // URLhaus nutzt `$all` auf über 7.500 Zeilen. Ohne eigenen Topf würde
      // daraus für jede Zeile eine einzelne Regel.
      return { ok: true, kind: 'block-domain-all', value: domain };
    }
    if (isException) return { ok: false, reason: 'ausnahme-eingeschraenkt' };
  }

  if (isException) return { ok: false, reason: 'ausnahme-nicht-domain' };

  if (!isValidUrlFilter(pattern)) return { ok: false, reason: 'muster-ungueltig' };

  // Der Kern dieses Moduls: Ein Muster ohne unterscheidungskräftigen Inhalt darf
  // nur bestehen bleiben, wenn eine Domain-Eingrenzung es einhegt.
  if (isCatastrophicallyBroad(pattern) && options.initiatorDomains.length === 0) {
    return { ok: false, reason: 'muster-zu-breit' };
  }

  /** @type {PatternRule} */
  const rule = { urlFilter: pattern };
  if (options.initiatorDomains.length > 0) rule.initiatorDomains = options.initiatorDomains;
  if (options.excludedInitiatorDomains.length > 0) {
    rule.excludedInitiatorDomains = options.excludedInitiatorDomains;
  }
  if (options.resourceTypes !== null) rule.resourceTypes = options.resourceTypes;

  return { ok: true, kind: 'block-pattern', rule };
}

/**
 * Erkennt und prüft eine Cosmetic-Zeile.
 *
 * @param {string} line
 * @param {boolean} includeCosmetic
 * @returns {{ok: true, kind: 'cosmetic', value: string} | {ok: false, reason: string} | null}
 */
function parseCosmeticLine(line, includeCosmetic) {
  const match = /^(.*?)#(@|\?|\$|\$\?)?#(.+)$/.exec(line);
  if (!match) return null;

  const [, domainPart, modifier, selector] = match;
  if (!includeCosmetic) return { ok: false, reason: 'cosmetic-deaktiviert' };
  if (modifier) return { ok: false, reason: 'cosmetic-erweitert' };
  if (domainPart.length > 0) return { ok: false, reason: 'cosmetic-domainspezifisch' };
  if (!isSafeCssSelector(selector)) return { ok: false, reason: 'cosmetic-unsicher' };

  return { ok: true, kind: 'cosmetic', value: selector.trim() };
}

/**
 * Wertet den Options-Teil aus.
 *
 * @param {string} optionString Alles hinter dem `$`.
 * @returns {{ok: true, initiatorDomains: string[], excludedInitiatorDomains: string[], resourceTypes: string[]|null}
 *   | {ok: false, reason: string}}
 */
export function parseOptions(optionString) {
  /** @type {string[]} */
  const initiatorDomains = [];
  /** @type {string[]} */
  const excludedInitiatorDomains = [];
  /** @type {Set<string>} */
  const resourceTypes = new Set();
  let sawTypeOption = false;
  let isAll = false;

  if (optionString.length === 0) {
    return { ok: true, initiatorDomains, excludedInitiatorDomains, resourceTypes: null, isAll };
  }

  for (const rawOption of optionString.split(',')) {
    const option = rawOption.trim().toLowerCase();
    if (option.length === 0) continue;

    const negated = option.startsWith('~');
    const withoutNegation = negated ? option.slice(1) : option;
    const separator = withoutNegation.indexOf('=');
    const name = separator === -1 ? withoutNegation : withoutNegation.slice(0, separator);
    const value = separator === -1 ? '' : withoutNegation.slice(separator + 1);

    if (UNSUPPORTED_OPTIONS.has(name)) return { ok: false, reason: `option-${name}` };
    if (IGNORABLE_OPTIONS.has(name)) continue;

    // `$all` = jeder Ressourcentyp einschließlich des Hauptdokuments.
    // URLhaus nutzt das auf 7.587 Zeilen; v5.0.0 verwarf sie alle als unbekannt
    // und verlor damit gut 80 % der Malware-Liste.
    if (name === 'all') {
      sawTypeOption = true;
      isAll = true;
      for (const type of BLOCKABLE_RESOURCE_TYPES) resourceTypes.add(type);
      resourceTypes.add('main_frame');
      continue;
    }

    if (name === 'domain' || name === 'from') {
      const scoped = parseDomainOption(value);
      if (!scoped.ok) return scoped;
      initiatorDomains.push(...scoped.included);
      excludedInitiatorDomains.push(...scoped.excluded);
      continue;
    }

    // `denyallow` und `to` grenzen die Ziel-Domain ein. Sie wegzulassen würde
    // die Regel verbreitern; das ist hier zu riskant.
    if (name === 'denyallow' || name === 'to' || name === 'method') {
      return { ok: false, reason: `option-${name}` };
    }

    const mapped = OPTION_TO_RESOURCE_TYPE[name];
    if (mapped) {
      sawTypeOption = true;
      // Negierte Typen lassen wir weg und nehmen stattdessen alle übrigen auf —
      // `excludedResourceTypes` und `resourceTypes` schließen sich in
      // declarativeNetRequest gegenseitig aus.
      if (negated) {
        for (const type of BLOCKABLE_RESOURCE_TYPES) {
          if (type !== mapped) resourceTypes.add(type);
        }
      } else {
        resourceTypes.add(mapped);
      }
      continue;
    }

    return { ok: false, reason: 'option-unbekannt' };
  }

  return {
    ok: true,
    initiatorDomains,
    excludedInitiatorDomains,
    resourceTypes: sawTypeOption ? [...resourceTypes] : null,
    isAll,
  };
}

/**
 * Zerlegt den Wert von `$domain=`.
 *
 * Format: `a.com|b.com|~c.com` — senkrechter Strich trennt, `~` schließt aus.
 *
 * @param {string} value
 * @returns {{ok: true, included: string[], excluded: string[]} | {ok: false, reason: string}}
 */
export function parseDomainOption(value) {
  /** @type {string[]} */
  const included = [];
  /** @type {string[]} */
  const excluded = [];

  for (const rawEntry of value.split('|')) {
    const entry = rawEntry.trim().toLowerCase();
    if (entry.length === 0) continue;

    const isExcluded = entry.startsWith('~');
    const domain = (isExcluded ? entry.slice(1) : entry).replace(/^\*\./, '');

    // Reguläre Ausdrücke als Domain-Wert (uBlock-Erweiterung) können wir nicht
    // abbilden.
    if (domain.startsWith('/') || !/^[a-z0-9.-]+$/.test(domain)) {
      return { ok: false, reason: 'domain-option-ungueltig' };
    }

    if (isExcluded) excluded.push(domain);
    else included.push(domain);
  }

  if (included.length === 0 && excluded.length === 0) {
    return { ok: false, reason: 'domain-option-leer' };
  }

  return { ok: true, included, excluded };
}

/**
 * Erkennt Muster ohne unterscheidungskräftigen Inhalt.
 *
 * Vorgehen: Anker, Platzhalter und Trennzeichen entfernen, ein führendes Schema
 * abschneiden. Was übrig bleibt, muss lang genug sein, um überhaupt etwas
 * auszusagen.
 *
 * @param {string} pattern
 * @returns {boolean}
 *
 * @example
 * isCatastrophicallyBroad('|https:');      // true — trifft jede HTTPS-Adresse
 * isCatastrophicallyBroad('|http://');     // true
 * isCatastrophicallyBroad('||werbung.test^'); // false
 * isCatastrophicallyBroad('/ezo/*');       // false
 */
export function isCatastrophicallyBroad(pattern) {
  if (typeof pattern !== 'string') return true;

  let core = pattern.replace(/^\|\|?/, '').replace(/\|$/, '');
  core = core.replace(/^https?:(\/\/)?/i, '').replace(/^\/\//, '');
  core = core.replace(/[*^]/g, '');

  return core.length < 4;
}

/**
 * Prüft, ob ein Muster als `urlFilter` taugt.
 *
 * @param {string} pattern
 * @returns {boolean}
 */
export function isValidUrlFilter(pattern) {
  if (typeof pattern !== 'string') return false;
  if (pattern.length === 0 || pattern.length > 2000) return false;

  // Chrome lehnt `urlFilter` mit Zeichen außerhalb des druckbaren ASCII-Bereichs
  // ab. Die Klasse reicht vom Leerzeichen (0x20) bis zur Tilde (0x7E).
  //
  // Vorsicht beim Anfassen: Eine frühere Fassung schrieb hier `\x00-\x7F`, wobei
  // die Escapes beim Umschreiben verlorengingen. Übrig blieb `[^ -]` — „alles
  // außer Leerzeichen und Bindestrich“, was auf praktisch jedes Muster zutrifft
  // und damit *sämtliche* Muster verwarf. Der Test dazu heißt
  // „akzeptiert normale Muster“ und hätte das sofort gezeigt.
  if (/[^ -~]/.test(pattern)) return false;

  let anchorLength = 0;
  if (pattern.startsWith('||')) anchorLength = 2;
  else if (pattern.startsWith('|')) anchorLength = 1;

  const inner = pattern.slice(anchorLength, -1);
  return !inner.includes('|');
}

/**
 * Sehr konservative Prüfung eines CSS-Selektors.
 *
 * @param {string} selector
 * @returns {boolean}
 */
export function isSafeCssSelector(selector) {
  if (typeof selector !== 'string') return false;
  const value = selector.trim();
  if (value.length === 0 || value.length > 300) return false;
  if (/[{}]/.test(value)) return false;
  if (value.includes('/*') || value.includes('*/')) return false;
  if (/:(-abp-|has-text|matches-css|xpath|upward|style|remove)\b/i.test(value)) return false;
  if (value.includes('\\')) return false;
  return true;
}

/**
 * Baut aus einem geparsten Ergebnis declarativeNetRequest-Regeln (ohne IDs).
 *
 * @param {ParsedFilterList} parsed
 * @param {object} [options]
 * @param {number} [options.chunkSize=500] Domains pro `requestDomains`-Regel.
 * @returns {Array<Omit<chrome.declarativeNetRequest.Rule, 'id'>>}
 */
export function buildRulesFromParsedList(parsed, { chunkSize = 500 } = {}) {
  const defaultTypes = [...BLOCKABLE_RESOURCE_TYPES];
  /** @type {Array<Omit<chrome.declarativeNetRequest.Rule, 'id'>>} */
  const rules = [];

  for (let i = 0; i < parsed.domains.length; i += chunkSize) {
    rules.push({
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: parsed.domains.slice(i, i + chunkSize),
        resourceTypes: defaultTypes,
      },
    });
  }

  // `$all`-Domains zusätzlich mit `main_frame`: Bei Schadsoftware-Listen ist
  // genau das der Punkt — die Seite selbst soll gar nicht erst laden.
  const documentTypes = [...new Set(['main_frame', ...defaultTypes])];
  for (let i = 0; i < (parsed.documentDomains?.length ?? 0); i += chunkSize) {
    rules.push({
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: parsed.documentDomains.slice(i, i + chunkSize),
        resourceTypes: documentTypes,
      },
    });
  }

  for (const pattern of parsed.patterns) {
    /** @type {Record<string, unknown>} */
    const condition = {
      urlFilter: pattern.urlFilter,
      resourceTypes: pattern.resourceTypes ?? defaultTypes,
    };
    if (pattern.initiatorDomains) condition.initiatorDomains = pattern.initiatorDomains;
    if (pattern.excludedInitiatorDomains) {
      condition.excludedInitiatorDomains = pattern.excludedInitiatorDomains;
    }

    rules.push({ priority: 1, action: { type: 'block' }, condition });
  }

  return rules;
}

/**
 * Bildet ein `urlFilter` auf einen regulären Ausdruck ab.
 *
 * Vereinfachte Nachbildung der Chrome-Semantik, ausreichend für die
 * Sicherheitsprüfung in {@link findSelfBlockingRules}.
 *
 * @param {string} urlFilter
 * @returns {RegExp|null} `null`, wenn sich daraus kein gültiger Ausdruck bauen lässt.
 */
export function urlFilterToRegExp(urlFilter) {
  let pattern = urlFilter;
  let prefix = '';
  let suffix = '';

  if (pattern.startsWith('||')) {
    prefix = '^[a-z-]+://([^/]*\\.)?';
    pattern = pattern.slice(2);
  } else if (pattern.startsWith('|')) {
    prefix = '^';
    pattern = pattern.slice(1);
  }

  if (pattern.endsWith('|')) {
    suffix = '$';
    pattern = pattern.slice(0, -1);
  }

  const escaped = pattern
    .replace(/[.+?()[\]{}\\$]/g, '\\$&')
    .replace(/\^/g, '(?:[^a-zA-Z0-9_\\-.%]|$)')
    .replace(/\*/g, '.*');

  try {
    return new RegExp(prefix + escaped + suffix, 'i');
  } catch {
    return null;
  }
}

/**
 * Findet Regeln, die eine der angegebenen Adressen blockieren würden.
 *
 * Letzte Verteidigungslinie: Selbst wenn ein zu breites Muster durch alle
 * anderen Prüfungen rutscht, darf es nicht die Adressen treffen, über die sich
 * die Erweiterung ihre eigenen Filterlisten holt. Sonst entsteht wieder der
 * Zustand, aus dem sich v5.0.0 nicht mehr selbst befreien konnte.
 *
 * @param {Array<Omit<chrome.declarativeNetRequest.Rule, 'id'>>} rules
 * @param {readonly string[]} canaryUrls Adressen, die erreichbar bleiben müssen.
 * @returns {Array<{index: number, url: string, condition: object}>}
 */
export function findSelfBlockingRules(rules, canaryUrls) {
  /** @type {Array<{index: number, url: string, condition: object}>} */
  const hits = [];

  const canaries = canaryUrls
    .map((url) => {
      try {
        return { url, hostname: new URL(url).hostname };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  rules.forEach((rule, index) => {
    const condition = rule.condition ?? {};

    // Auf Domains eingegrenzte Regeln können unsere Downloads nicht treffen:
    // Die laufen ohne Dokument-Ursprung.
    if (condition.initiatorDomains?.length > 0) return;

    for (const canary of canaries) {
      if (Array.isArray(condition.requestDomains)) {
        const blocked = condition.requestDomains.some(
          (domain) => canary.hostname === domain || canary.hostname.endsWith(`.${domain}`)
        );
        if (blocked) {
          hits.push({ index, url: canary.url, condition });
          break;
        }
      }

      if (typeof condition.urlFilter === 'string') {
        const regex = urlFilterToRegExp(condition.urlFilter);
        if (regex?.test(canary.url)) {
          hits.push({ index, url: canary.url, condition });
          break;
        }
      }
    }
  });

  return hits;
}
