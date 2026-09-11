/**
 * Content-Script für Cosmetic-Filter.
 *
 * Läuft in der **isolierten Welt** und hat damit Zugriff auf das DOM, aber nicht
 * auf die JavaScript-Umgebung der Seite. Genau deshalb wurde `patchScriptCreation`
 * aus v4 hier ersatzlos gestrichen: Die Funktion überschrieb
 * `document.createElement`, um Werbeskripte abzufangen — in der isolierten Welt
 * ist das wirkungslos, weil Seitenskripte ihr eigenes `document.createElement`
 * benutzen. Der Code lief bei jedem Seitenaufruf und hat nie etwas bewirkt.
 *
 * Alles, was tatsächlich in die Seitenumgebung eingreifen muss, liegt jetzt in
 * `main-world.js` und wird vom Manifest mit `"world": "MAIN"` registriert — ohne
 * `eval`, ohne nachgeladenen Code.
 */

import { MSG } from '../core/messages.js';
import { buildStylesheet } from '../core/cosmetic-rules.js';
import { COSMETIC_SELECTORS } from '../core/cosmetic-rules.js';
import { createDomMonitor } from './dom-monitor.js';

/** Kennung des eingefügten Style-Elements. */
const STYLE_ID = 'pblock-cosmetic';

/** Wie lange Treffer gesammelt werden, bevor sie gemeldet werden. */
const REPORT_INTERVAL_MS = 2_000;

/** @type {HTMLStyleElement|null} */
let styleElement = null;
/** @type {string[]} */
let activeSelectors = [];
/** @type {WeakSet<Element>} */
let counted = new WeakSet();
let pendingCount = 0;
/** @type {ReturnType<typeof setTimeout>|null} */
let reportTimer = null;
/** @type {ReturnType<typeof createDomMonitor>|null} */
let monitor = null;

/**
 * Prüft einen Selektor gegen die echte CSS-Engine.
 *
 * Das ist die zuverlässigste verfügbare Prüfung: Was `querySelector` akzeptiert,
 * akzeptiert auch das Stylesheet. In v4 wurden Selektoren aus dem Element-Picker
 * ungeprüft an eine gemeinsame Sammelregel gehängt — ein ungültiger Eintrag
 * machte damit sämtliche Cosmetic-Filter unwirksam.
 *
 * @param {string} selector
 * @returns {boolean}
 */
function isSupportedSelector(selector) {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ermittelt die Selektoren aus der Konfiguration des Service Workers.
 * @param {object} config
 * @returns {string[]}
 */
function selectorsFromConfig(config) {
  if (!config?.active || !config.cosmeticFiltersEnabled) return [];

  /** @type {string[]} */
  const selectors = [];
  const categories = config.categories ?? {};

  if (categories.ads?.enabled) selectors.push(...COSMETIC_SELECTORS.ads);
  if (categories.social?.enabled) selectors.push(...COSMETIC_SELECTORS.social);
  if (categories.analytics?.enabled) selectors.push(...COSMETIC_SELECTORS.analytics);
  if (categories.annoyances?.enabled) selectors.push(...COSMETIC_SELECTORS.annoyances);

  selectors.push(...(config.elementRules ?? []));
  return [...new Set(selectors)];
}

/**
 * Schreibt das Stylesheet in die Seite.
 * @param {string[]} selectors
 */
function applyStylesheet(selectors) {
  const { css, used } = buildStylesheet(selectors, { validate: isSupportedSelector });
  activeSelectors = used;

  if (css.length === 0) {
    styleElement?.remove();
    styleElement = null;
    return;
  }

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = STYLE_ID;
    // In `documentElement` statt in `head`: Bei `document_start` existiert `head`
    // noch nicht zuverlässig. v4 hatte hier eine Race Condition, durch die das
    // Stylesheet auf schnellen Seiten gelegentlich gar nicht ankam.
    (document.head ?? document.documentElement)?.appendChild(styleElement);
  }

  if (styleElement.textContent !== css) styleElement.textContent = css;
}

/**
 * Zählt Elemente, die von den aktiven Selektoren getroffen werden.
 *
 * Wichtig: Das Verstecken übernimmt das Stylesheet. Hier wird ausschließlich
 * gezählt — v4 setzte zusätzlich Inline-Styles auf jedem Treffer, was bei
 * Hunderten Elementen unnötige Layout-Neuberechnungen auslöste.
 *
 * @param {Element[]|null} roots `null` bedeutet: das gesamte Dokument prüfen.
 */
function countMatches(roots) {
  if (activeSelectors.length === 0) return;

  const selector = activeSelectors.join(',');
  /** @type {Iterable<Element>} */
  let candidates;

  if (roots === null) {
    candidates = document.querySelectorAll(selector);
  } else {
    const found = [];
    for (const root of roots) {
      try {
        if (root.matches(selector)) found.push(root);
        found.push(...root.querySelectorAll(selector));
      } catch {
        // Element wurde zwischenzeitlich aus dem Dokument entfernt.
      }
    }
    candidates = found;
  }

  let added = 0;
  for (const element of candidates) {
    if (counted.has(element)) continue;
    counted.add(element);
    added += 1;
  }

  if (added > 0) {
    pendingCount += added;
    scheduleReport();
  }
}

/**
 * Meldet die gezählten Treffer gebündelt an den Service Worker.
 */
function scheduleReport() {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    if (pendingCount === 0) return;

    const count = pendingCount;
    pendingCount = 0;

    chrome.runtime.sendMessage({ type: MSG.STATS_RECORD_COSMETIC, count }).catch(() => {
      // Der Service Worker schläft oder die Erweiterung wurde neu geladen.
      // Zurücklegen, damit beim nächsten Versuch nichts fehlt.
      pendingCount += count;
    });
  }, REPORT_INTERVAL_MS);
}

/**
 * Übernimmt eine neue Konfiguration.
 * @param {object} config
 */
function applyConfig(config) {
  const selectors = selectorsFromConfig(config);

  if (selectors.length === 0) {
    styleElement?.remove();
    styleElement = null;
    activeSelectors = [];
    monitor?.stop();
    monitor = null;
    return;
  }

  // Zähler zurücksetzen: Bei geänderten Selektoren sind andere Elemente betroffen.
  counted = new WeakSet();
  applyStylesheet(selectors);
  countMatches(null);

  if (!monitor) {
    monitor = createDomMonitor((elements) => countMatches(elements));
    monitor.start(document.documentElement);
  }
}

/**
 * Holt die Konfiguration und wendet sie an.
 */
async function initialize() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.GET_CONTENT_CONFIG });
    if (response?.ok) applyConfig(response.data);
  } catch {
    // Beim Start des Browsers ist der Service Worker gelegentlich noch nicht
    // erreichbar. Beim nächsten Push aus dem Hintergrund greift die Konfiguration.
  }
}

// Änderungen aus den Einstellungen sofort übernehmen, ohne Neuladen der Seite.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MSG.GET_CONTENT_CONFIG) return false;
  applyConfig(message.payload);
  sendResponse({ ok: true });
  return false;
});

// Beim Verlassen der Seite noch offene Treffer melden, damit sie nicht verfallen.
window.addEventListener('pagehide', () => {
  if (pendingCount > 0) {
    chrome.runtime
      .sendMessage({ type: MSG.STATS_RECORD_COSMETIC, count: pendingCount })
      .catch(() => {});
    pendingCount = 0;
  }
});

initialize();
