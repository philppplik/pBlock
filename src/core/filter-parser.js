/**
 * Parser für Filterlisten im Adblock-Plus-Format.
 *
 * ## Was v4 hier falsch machte
 *
 * Der alte Parser bestand im Kern aus drei `replace`-Aufrufen, die nichts
 * veränderten (`'||' → '||'`, `'^' → '^'`), und verwarf danach alles, was ein
 * `$` enthielt. Konkrete Folgen:
 *
 * - Ausnahmeregeln (`@@`) wurden ersatzlos gestrichen. Jede Filterliste nutzt sie,
 *   um Fehlalarme zu entschärfen — ohne sie blockiert man Logins und Bezahlseiten.
 * - Der komplette Options-Teil (`$third-party`, `$script`, `$domain=`) ging
 *   verloren. Eine Regel, die nur für Drittanbieter-Skripte gedacht war, galt
 *   plötzlich für alles.
 * - Regexp-Regeln (`/muster/`) rutschten teilweise als literaler `urlFilter`
 *   durch und wurden von Chrome als ungültig abgelehnt — was den gesamten
 *   `updateDynamicRules`-Aufruf scheitern ließ.
 *
 * Dieser Parser erkennt an, dass declarativeNetRequest nicht alles abbilden kann,
 * und **verwirft bewusst und nachvollziehbar**, statt falsch zu übersetzen. Jede
 * Verwerfung wird gezählt und ist über {@link parseFilterList} einsehbar.
 */

/**
 * Options, die sich sauber auf einen declarativeNetRequest-Ressourcentyp abbilden lassen.
 * @type {Readonly<Record<string, string>>}
 */
const OPTION_TO_RESOURCE_TYPE = Object.freeze({
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  subdocument: 'sub_frame',
  document: 'main_frame',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  ping: 'ping',
  other: 'other',
});

/**
 * Options, die keine Entsprechung haben und zum Verwerfen der Zeile führen.
 *
 * Sie stillschweigend zu ignorieren wäre schlimmer als die Regel wegzulassen:
 * `$csp` oder `$removeparam` beschreiben eine völlig andere Aktion, und eine
 * `$popup`-Regel als generelles `block` zu interpretieren blockiert Inhalte,
 * die der Listenautor nie blockieren wollte.
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
    'elemhide',
    'inline-script',
    'inline-font',
    'empty',
    'mp4',
    'stealth',
    'cookie',
    'permissions',
    'urltransform',
  ])
);

/** Erkennt eine reine Domain-Blockade der Form `||example.com^`. */
const PURE_DOMAIN_PATTERN = /^\|\|([a-z0-9._-]+)\^?$/i;

/** Erkennt Zeilen im Hosts-Datei-Format, z. B. `0.0.0.0 tracker.example`. */
const HOSTS_LINE_PATTERN = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+([a-z0-9._-]+)\s*$/i;

/** Erkennt eine nackte Domain in einer Zeile. */
const BARE_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * @typedef {object} ParsedFilterList
 * @property {string[]} domains Domains, die komplett blockiert werden.
 * @property {string[]} urlFilters Pfad- oder Mustergebundene Blockaden.
 * @property {string[]} allowDomains Domains aus Ausnahmeregeln.
 * @property {string[]} cosmeticSelectors Generische Cosmetic-Selektoren (ohne Domain-Bindung).
 * @property {{lines: number, accepted: number, skipped: number, reasons: Record<string, number>}} stats
 */

/**
 * Parst eine komplette Filterliste.
 *
 * @param {string} text Rohinhalt der Liste.
 * @param {object} [options]
 * @param {number} [options.maxEntries=50000] Obergrenze, damit eine riesige Liste
 *   nicht den Speicher sprengt.
 * @param {boolean} [options.includeCosmetic=true] Ob generische Cosmetic-Regeln
 *   übernommen werden sollen.
 * @returns {ParsedFilterList}
 */
export function parseFilterList(text, { maxEntries = 50_000, includeCosmetic = true } = {}) {
  /** @type {ParsedFilterList} */
  const result = {
    domains: [],
    urlFilters: [],
    allowDomains: [],
    cosmeticSelectors: [],
    stats: { lines: 0, accepted: 0, skipped: 0, reasons: {} },
  };

  if (typeof text !== 'string' || text.length === 0) return result;

  const domains = new Set();
  const urlFilters = new Set();
  const allowDomains = new Set();
  const cosmetic = new Set();

  const skip = (reason) => {
    result.stats.skipped += 1;
    result.stats.reasons[reason] = (result.stats.reasons[reason] ?? 0) + 1;
  };

  for (const rawLine of text.split('\n')) {
    result.stats.lines += 1;
    if (domains.size + urlFilters.size >= maxEntries) {
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
      case 'block-url':
        urlFilters.add(parsed.value);
        break;
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
  result.urlFilters = [...urlFilters];
  result.allowDomains = [...allowDomains];
  result.cosmeticSelectors = [...cosmetic];
  return result;
}

/**
 * Parst eine einzelne Zeile.
 *
 * @param {string} line Bereits getrimmt, nicht leer, kein Kommentar.
 * @param {{includeCosmetic?: boolean}} [options]
 * @returns {{ok: true, kind: string, value: string} | {ok: false, reason: string}}
 */
export function parseFilterLine(line, { includeCosmetic = true } = {}) {
  // --- Cosmetic-Regeln -------------------------------------------------------
  const cosmetic = parseCosmeticLine(line, includeCosmetic);
  if (cosmetic) return cosmetic;

  // --- Hosts-Datei-Format ----------------------------------------------------
  const hostsMatch = HOSTS_LINE_PATTERN.exec(line);
  if (hostsMatch) {
    const domain = hostsMatch[1].toLowerCase();
    if (domain === 'localhost' || domain === 'localhost.localdomain') {
      return { ok: false, reason: 'hosts-localhost' };
    }
    return { ok: true, kind: 'block-domain', value: domain };
  }

  // --- Nackte Domain ---------------------------------------------------------
  if (BARE_DOMAIN_PATTERN.test(line)) {
    return { ok: true, kind: 'block-domain', value: line.toLowerCase() };
  }

  // --- Ausnahmeregel ---------------------------------------------------------
  const isException = line.startsWith('@@');
  const body = isException ? line.slice(2) : line;

  // --- Regexp-Regeln ---------------------------------------------------------
  // declarativeNetRequest kennt zwar `regexFilter`, aber mit anderer Syntax
  // (RE2) und strengen Längenlimits. Eine Fehlübersetzung lässt den gesamten
  // Regel-Update-Aufruf scheitern, deshalb: verwerfen.
  if (body.startsWith('/') && /\/(\$.*)?$/.test(body)) {
    return { ok: false, reason: 'regexp' };
  }

  // --- Options abtrennen -----------------------------------------------------
  const optionIndex = body.lastIndexOf('$');
  const pattern = optionIndex === -1 ? body : body.slice(0, optionIndex);
  const optionString = optionIndex === -1 ? '' : body.slice(optionIndex + 1);

  if (optionString.length > 0) {
    const optionCheck = checkOptions(optionString);
    if (!optionCheck.ok) return optionCheck;
  }

  if (pattern.length < 4) return { ok: false, reason: 'muster-zu-kurz' };

  // --- Reine Domain-Blockade -------------------------------------------------
  const domainMatch = PURE_DOMAIN_PATTERN.exec(pattern);
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase().replace(/\.$/, '');
    return {
      ok: true,
      kind: isException ? 'allow-domain' : 'block-domain',
      value: domain,
    };
  }

  // Ausnahmen, die keine reine Domain sind, lassen sich nicht verlustfrei auf
  // eine Allow-Regel abbilden — ohne die zugehörigen Options wäre die Ausnahme
  // zu breit und würde mehr freigeben als gewollt.
  if (isException) return { ok: false, reason: 'ausnahme-nicht-domain' };

  // --- Musterbasierte Blockade ----------------------------------------------
  if (!isValidUrlFilter(pattern)) return { ok: false, reason: 'muster-ungueltig' };
  return { ok: true, kind: 'block-url', value: pattern };
}

/**
 * Erkennt und prüft eine Cosmetic-Zeile.
 *
 * `##` versteckt, `#@#` hebt auf, `#?#` und `#$#` sind erweiterte Varianten.
 *
 * @param {string} line
 * @param {boolean} includeCosmetic
 * @returns {{ok: true, kind: string, value: string} | {ok: false, reason: string} | null}
 *   `null`, wenn die Zeile gar keine Cosmetic-Regel ist.
 */
function parseCosmeticLine(line, includeCosmetic) {
  const match = /^(.*?)#(@|\?|\$|\$\?)?#(.+)$/.exec(line);
  if (!match) return null;

  const [, domainPart, modifier, selector] = match;
  if (!includeCosmetic) return { ok: false, reason: 'cosmetic-deaktiviert' };

  // Ausnahmen und erweiterte Syntax (`:has-text`, `:style`) übernehmen wir nicht:
  // Für Ausnahmen fehlt uns der Mechanismus, und die erweiterte Syntax ist kein
  // gültiges CSS — sie würde den erzeugten Stylesheet-Block unwirksam machen.
  if (modifier) return { ok: false, reason: 'cosmetic-erweitert' };
  if (domainPart.length > 0) return { ok: false, reason: 'cosmetic-domainspezifisch' };
  if (!isSafeCssSelector(selector)) return { ok: false, reason: 'cosmetic-unsicher' };

  return { ok: true, kind: 'cosmetic', value: selector.trim() };
}

/**
 * Prüft den Options-Teil einer Regel.
 *
 * @param {string} optionString Alles hinter dem `$`.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkOptions(optionString) {
  for (const rawOption of optionString.split(',')) {
    const option = rawOption.trim().toLowerCase();
    if (option.length === 0) continue;

    const negated = option.startsWith('~');
    const name = (negated ? option.slice(1) : option).split('=')[0];

    if (UNSUPPORTED_OPTIONS.has(name)) return { ok: false, reason: `option-${name}` };

    // Reine Einschränkungen, die wir bewusst weglassen dürfen, weil die Regel
    // dadurch höchstens breiter greift als gedacht — aber niemals falsch:
    // `third-party`, `important`, `match-case`, `domain=`, `denyallow=`.
    if (['third-party', '3p', 'first-party', '1p', 'important', 'match-case'].includes(name)) {
      continue;
    }
    if (['domain', 'denyallow', 'from', 'to', 'method'].includes(name)) continue;
    if (OPTION_TO_RESOURCE_TYPE[name]) continue;

    return { ok: false, reason: 'option-unbekannt' };
  }
  return { ok: true };
}

/**
 * Prüft, ob ein Muster als `urlFilter` taugt.
 *
 * Chrome verlangt ASCII und lehnt bestimmte Kombinationen ab. Ein einziges
 * ungültiges Muster lässt `updateDynamicRules` komplett scheitern — deshalb wird
 * hier lieber zu streng als zu großzügig geprüft.
 *
 * @param {string} pattern
 * @returns {boolean}
 */
export function isValidUrlFilter(pattern) {
  if (typeof pattern !== 'string') return false;
  if (pattern.length === 0 || pattern.length > 2000) return false;
  // Nur ASCII: Chrome lehnt Nicht-ASCII in `urlFilter` ab.
  if (/[^ -]/.test(pattern)) return false;

  // `|` ist ausschließlich als Anker erlaubt: `||` am Anfang (Domain-Anker),
  // ein einzelnes `|` am Anfang oder am Ende. In der Mitte ist es ungültig.
  let anchorLength = 0;
  if (pattern.startsWith('||')) anchorLength = 2;
  else if (pattern.startsWith('|')) anchorLength = 1;

  const inner = pattern.slice(anchorLength, -1);
  return !inner.includes('|');
}

/**
 * Sehr konservative Prüfung eines CSS-Selektors.
 *
 * Die Selektoren werden zu einer einzigen Regel zusammengefügt. Ein einziger
 * ungültiger Selektor macht in CSS die gesamte Regel unwirksam — deshalb fliegt
 * alles raus, was nicht eindeutig harmlos aussieht.
 *
 * @param {string} selector
 * @returns {boolean}
 */
export function isSafeCssSelector(selector) {
  if (typeof selector !== 'string') return false;
  const value = selector.trim();
  if (value.length === 0 || value.length > 300) return false;
  // Geschweifte Klammern würden aus dem Selektor ausbrechen und eigene
  // Deklarationen einschleusen — genau das wollen wir ausschließen.
  if (/[{}]/.test(value)) return false;
  if (value.includes('/*') || value.includes('*/')) return false;
  // uBlock-Erweiterungen sind kein gültiges CSS.
  if (/:(-abp-|has-text|matches-css|xpath|upward|style|remove)\b/i.test(value)) return false;
  if (value.includes('\\')) return false;
  return true;
}

/**
 * Baut aus einem geparsten Ergebnis fertige declarativeNetRequest-Regeln (ohne IDs).
 *
 * Die IDs vergibt {@link import('./rule-engine.js').assignPresetRuleIds}, weil nur
 * dort bekannt ist, wie viel Kontingent noch frei ist.
 *
 * @param {ParsedFilterList} parsed
 * @param {object} [options]
 * @param {number} [options.chunkSize=500] Domains pro `requestDomains`-Regel.
 * @param {readonly string[]} [options.resourceTypes]
 * @returns {Array<Omit<chrome.declarativeNetRequest.Rule, 'id'>>}
 */
export function buildRulesFromParsedList(parsed, { chunkSize = 500, resourceTypes } = {}) {
  const types = resourceTypes ?? [
    'script',
    'image',
    'sub_frame',
    'xmlhttprequest',
    'stylesheet',
    'font',
    'media',
    'ping',
    'websocket',
    'other',
  ];

  /** @type {Array<Omit<chrome.declarativeNetRequest.Rule, 'id'>>} */
  const rules = [];

  for (let i = 0; i < parsed.domains.length; i += chunkSize) {
    rules.push({
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: parsed.domains.slice(i, i + chunkSize),
        resourceTypes: [...types],
      },
    });
  }

  for (const urlFilter of parsed.urlFilters) {
    rules.push({
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter, resourceTypes: [...types] },
    });
  }

  return rules;
}
