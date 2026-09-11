/**
 * Cosmetic-Filter: Selektor-Katalog und Stylesheet-Erzeugung.
 *
 * ## Warum das hier nur eine Datei ist
 *
 * v4 pflegte dieselben Selektoren **zweimal**: einmal in `js/cosmetic-filter.js`
 * für die Injektion aus dem Hintergrund, einmal in `js/cosmetic-injector.js` für
 * das Content-Script. Die Listen waren bereits auseinandergelaufen — das
 * Content-Script kannte 20 Selektoren mehr. Zusätzlich griff der Hintergrundpfad
 * gar nicht: `CosmeticFilter.getActiveRules()` las `window.location`, und
 * `window` existiert im Service Worker nicht. Der Aufruf warf jedes Mal einen
 * ReferenceError, der von einem umschließenden `try/catch` verschluckt wurde.
 *
 * Jetzt gibt es eine Quelle, und injiziert wird ausschließlich aus dem
 * Content-Script — dort, wo auch das DOM ist.
 */

/**
 * Selektoren nach Gruppe.
 *
 * Auswahlkriterium: Ein Selektor kommt nur rein, wenn er auf echten Seiten
 * praktisch nur Werbung trifft. Zu breite Muster kosten mehr Vertrauen als sie
 * an Werbung einsparen — eine fälschlich versteckte Bezahlschaltfläche merkt der
 * Nutzer sofort, eine durchgerutschte Anzeige nicht.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const COSMETIC_SELECTORS = Object.freeze({
  ads: Object.freeze([
    // Klassische Werbecontainer
    '.adsbox',
    '.adsbygoogle',
    'ins.adsbygoogle',
    '.ad-banner',
    '.ad-container',
    '.ad-wrapper',
    '.ad-placement',
    '.ad-slot',
    '.ad-unit',
    '.ad-zone',
    '.advertisement',
    '.advertising',
    '.banner_ads',
    '.textads',
    '.adbox',
    // Google Publisher Tag
    'div[id^="div-gpt-ad"]',
    'div[id^="google_ads"]',
    'iframe[id*="google_ads"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adservice.google"]',
    'iframe[src*="amazon-adsystem"]',
    // Teilstring-Muster: bewusst auf eindeutige Wortstämme beschränkt
    '[class*="ad-container"]',
    '[class*="ad-wrapper"]',
    '[class*="ad-banner"]',
    '[class*="ad-placement"]',
    '[class*="ad-slot"]',
    '[class*="advertisement"]',
    '[class*="sponsored-content"]',
    '[class*="sponsored-post"]',
    '[id*="ad-container"]',
    '[id*="ad-wrapper"]',
    '[id*="ad-banner"]',
    // Datenattribute der großen Ad-Server
    '[data-ad-slot]',
    '[data-ad-unit]',
    '[data-google-query-id]',
    '[data-adunitid]',
  ]),

  social: Object.freeze([
    '.fb-like',
    '.fb-page',
    '.fb-share-button',
    '.twitter-follow-button',
    '.twitter-share-button',
    '.twitter-timeline',
    '.pinterest-widget',
    '.linkedin-widget',
    '[data-widget="social"]',
  ]),

  analytics: Object.freeze([
    // Zählpixel. Sichtbar sind sie ohnehin nicht — Ausblenden verhindert aber,
    // dass sie in Screenreadern und Druckansichten auftauchen.
    'img[width="1"][height="1"]',
    'img[width="0"][height="0"]',
    'iframe[width="1"][height="1"]',
    'iframe[width="0"][height="0"]',
  ]),

  annoyances: Object.freeze([
    '.cookie-banner',
    '.cookie-notice',
    '.cookie-consent',
    '#cookie-banner',
    '#cookie-notice',
    '#cookie-consent',
    '[class*="cookie-banner"]',
    '[class*="cookie-notice"]',
    '[class*="cookie-consent"]',
    '[class*="newsletter-popup"]',
    '[class*="subscription-popup"]',
    '[class*="notification-prompt"]',
  ]),
});

/**
 * Selektoren, die aus v4 bewusst **entfernt** wurden.
 *
 * Dokumentiert, damit sie niemand versehentlich wieder einsammelt.
 *
 * - `div[style*="min-height: 250px"]` — trifft jedes Layout mit dieser Mindesthöhe,
 *   also auch Artikelbilder und Videoplayer.
 * - `[data-ad]` — `data-ad` wird von diversen Frameworks als generisches
 *   Datenattribut benutzt (z. B. „additional data“).
 * - `[class^="ad_"]`, `[id^="ad_"]` — kollidiert mit Präfixen wie `ad_min` in
 *   Verwaltungsoberflächen.
 * - `.fb-root:not(:empty)` — versteckt auch funktionierende Kommentar-Plugins.
 *
 * @type {readonly string[]}
 */
export const REMOVED_LEGACY_SELECTORS = Object.freeze([
  'div[style*="min-height: 250px"][style*="min-width: 300px"]',
  'div[style*="min-height:250px"][style*="min-width:300px"]',
  '[data-ad]',
  '[class^="ad_"]',
  '[class^="ads_"]',
  '[id^="ad_"]',
  '[id^="ads_"]',
  '.fb-root:not(:empty)',
]);

/**
 * Ermittelt die aktiven Selektoren für eine Seite.
 *
 * @param {object} input
 * @param {import('./settings.js').Settings} input.settings
 * @param {string|null} input.hostname Host der Seite.
 * @param {boolean} input.isWhitelisted Ergebnis der Whitelist-Prüfung.
 * @returns {string[]} Leeres Array, wenn nichts versteckt werden soll.
 */
export function selectCosmeticSelectors({ settings, hostname, isWhitelisted }) {
  if (!settings?.masterEnabled) return [];
  if (!settings.cosmeticFiltersEnabled) return [];
  if (isWhitelisted) return [];

  /** @type {string[]} */
  const selectors = [];
  const categories = settings.categories ?? {};

  if (categories.ads?.enabled) selectors.push(...COSMETIC_SELECTORS.ads);
  if (categories.social?.enabled) selectors.push(...COSMETIC_SELECTORS.social);
  if (categories.analytics?.enabled) selectors.push(...COSMETIC_SELECTORS.analytics);
  if (categories.annoyances?.enabled) selectors.push(...COSMETIC_SELECTORS.annoyances);

  // Vom Nutzer über den Element-Picker angelegte Regeln gelten immer, sobald
  // Cosmetic-Filter grundsätzlich aktiv sind — unabhängig von Kategorien.
  selectors.push(...collectElementRuleSelectors(settings.elementRules ?? [], hostname));

  return [...new Set(selectors)];
}

/**
 * Filtert Element-Regeln auf die, die für einen Host gelten.
 * @param {readonly import('./settings.js').ElementRule[]} elementRules
 * @param {string|null} hostname
 * @returns {string[]}
 */
function collectElementRuleSelectors(elementRules, hostname) {
  /** @type {string[]} */
  const selectors = [];
  for (const rule of elementRules) {
    if (!rule.siteOnly) {
      selectors.push(rule.selector);
      continue;
    }
    if (!hostname || !rule.domain) continue;
    if (hostname === rule.domain || hostname.endsWith(`.${rule.domain}`)) {
      selectors.push(rule.selector);
    }
  }
  return selectors;
}

/**
 * Baut das Stylesheet.
 *
 * Zwei Details, die in v4 fehlten:
 *
 * 1. Die Selektoren werden **einzeln validiert**. In CSS macht ein einziger
 *    ungültiger Selektor in einer Selektorliste die komplette Regel unwirksam.
 *    v4 hängte ungeprüfte Nutzereingaben aus dem Element-Picker an die Liste an —
 *    ein Tippfehler im Selektorfeld legte damit *alle* Cosmetic-Filter lahm.
 * 2. Es wird pro Selektor eine eigene Regel erzeugt statt einer einzigen
 *    Sammelregel. Kostet ein paar Bytes, isoliert aber Fehler.
 *
 * @param {readonly string[]} selectors
 * @param {{validate?: (selector: string) => boolean}} [options]
 * @returns {{css: string, used: string[], rejected: string[]}}
 */
export function buildStylesheet(selectors, { validate } = {}) {
  /** @type {string[]} */
  const used = [];
  /** @type {string[]} */
  const rejected = [];

  for (const selector of selectors) {
    const isValid = validate ? validate(selector) : isStructurallyValidSelector(selector);
    if (isValid) used.push(selector);
    else rejected.push(selector);
  }

  if (used.length === 0) return { css: '', used, rejected };

  const declarations = 'display:none!important;visibility:hidden!important;';
  const css = used.map((selector) => `${selector}{${declarations}}`).join('\n');
  return { css, used, rejected };
}

/**
 * Strukturprüfung eines Selektors ohne DOM.
 *
 * Im Content-Script wird zusätzlich `document.querySelector` als echter Test
 * benutzt. Diese Funktion existiert, damit dieselbe Logik auch im Service Worker
 * und in Tests läuft, wo es kein DOM gibt.
 *
 * @param {string} selector
 * @returns {boolean}
 */
export function isStructurallyValidSelector(selector) {
  if (typeof selector !== 'string') return false;
  const value = selector.trim();
  if (value.length === 0 || value.length > 500) return false;

  // Ein Selektor darf niemals aus seinem Block ausbrechen.
  if (/[{}]/.test(value)) return false;
  if (value.includes('/*') || value.includes('*/')) return false;
  if (value.includes(';')) return false;
  if (/@import|javascript:|expression\s*\(/i.test(value)) return false;

  // Ausgeglichene Klammern — ein offener Attributselektor verschluckt den Rest.
  if (!hasBalancedBrackets(value)) return false;

  // uBlock-/AdGuard-Erweiterungen sind kein gültiges CSS.
  if (/:(-abp-|has-text|matches-css|xpath|upward|style|remove|contains)\b/i.test(value)) {
    return false;
  }

  return true;
}

/**
 * Prüft, ob runde und eckige Klammern sowie Anführungszeichen paarweise auftreten.
 * @param {string} value
 * @returns {boolean}
 */
export function hasBalancedBrackets(value) {
  let round = 0;
  let square = 0;
  let quote = null;

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') round += 1;
    else if (char === ')') round -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;

    if (round < 0 || square < 0) return false;
  }

  return round === 0 && square === 0 && quote === null;
}
