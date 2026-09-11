/**
 * Element-Picker: Elemente auf einer Seite anklicken und dauerhaft ausblenden.
 *
 * ## Zwei strukturelle Änderungen gegenüber v4
 *
 * 1. **Shadow DOM.** v4 hängte die Bedienelemente direkt in die Seite und
 *    formatierte jedes davon mit langen Inline-Style-Strings. Seiten mit
 *    aggressivem CSS (`* { box-sizing: ... }`, globale `z-index`-Stapel,
 *    `!important` auf `div`) haben die Oberfläche trotzdem verzerrt. Ein
 *    geschlossener Shadow Root ist gegen Seiten-CSS immun — und die Seite sieht
 *    unsere Elemente nicht, was auch für Seiten-Skripte sauberer ist.
 *
 * 2. **Selektorauswahl nach Treffgenauigkeit.** v4 nahm den erstbesten Kandidaten:
 *    Hatte ein Element eine Klasse, wurde daraus `.klasse` — auch wenn das 200
 *    weitere Elemente traf. Der Nutzer klickte auf ein Werbebanner und verlor die
 *    halbe Seite. Jetzt werden Kandidaten erzeugt, gemessen und der spezifischste
 *    gewinnt; die Trefferzahl steht vor dem Bestätigen sichtbar da.
 */

import { MSG } from '../core/messages.js';

/** Kennung des Host-Elements in der Seite. */
const HOST_ID = 'pblock-picker-host';

/** Wie lange das Rückgängig-Angebot sichtbar bleibt. */
const UNDO_TIMEOUT_MS = 8_000;

/** @type {HTMLElement|null} */
let host = null;
/** @type {ShadowRoot|null} */
let shadow = null;
/** @type {Element|null} */
let current = null;
let active = false;

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }

  .overlay { position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; }

  .highlight {
    position: fixed; z-index: 2147483645; pointer-events: none;
    border: 2px solid #E5484D; background: rgba(229, 72, 77, 0.12);
    border-radius: 3px; transition: all 80ms ease-out;
  }

  .bar {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647; display: flex; align-items: center; gap: 16px;
    padding: 12px 18px; border-radius: 12px;
    background: #16181C; color: #E6E8EB; border: 1px solid #2A2E35;
    box-shadow: 0 12px 32px rgba(0,0,0,.45); font-size: 13px; line-height: 1.4;
  }
  .bar strong { color: #E5484D; font-weight: 600; }
  .bar kbd {
    padding: 2px 6px; border-radius: 4px; background: #22262E;
    border: 1px solid #333842; font-size: 11px; font-family: ui-monospace, monospace;
  }

  .tip {
    position: fixed; z-index: 2147483647; pointer-events: none; max-width: 420px;
    padding: 8px 12px; border-radius: 8px;
    background: #16181C; color: #E6E8EB; border: 1px solid #2A2E35;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all;
  }
  .tip .count { color: #F0883E; }

  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.6);
  }

  .dialog {
    width: 480px; max-width: calc(100vw - 32px);
    padding: 24px; border-radius: 16px;
    background: #16181C; color: #E6E8EB; border: 1px solid #2A2E35;
    box-shadow: 0 24px 64px rgba(0,0,0,.5);
  }
  .dialog h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
  .dialog p.sub { margin: 0 0 20px; font-size: 13px; color: #9BA1AC; }

  label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 500; color: #C3C8D0; }

  input[type="text"] {
    width: 100%; padding: 10px 12px; border-radius: 8px;
    background: #0F1114; color: #E6E8EB; border: 1px solid #2A2E35;
    font-size: 13px; font-family: ui-monospace, monospace;
  }
  input[type="text"]:focus { outline: 2px solid #E5484D; outline-offset: 1px; border-color: #E5484D; }

  .hint { margin: 8px 0 0; font-size: 12px; }
  .hint.ok { color: #3FB950; }
  .hint.warn { color: #F0883E; }
  .hint.error { color: #E5484D; }

  .check { display: flex; gap: 10px; align-items: flex-start; margin: 20px 0; cursor: pointer; }
  .check input { margin-top: 2px; accent-color: #E5484D; width: 16px; height: 16px; }
  .check span { font-size: 13px; }
  .check small { display: block; color: #9BA1AC; font-size: 12px; margin-top: 2px; }

  .actions { display: flex; gap: 10px; justify-content: flex-end; }

  button {
    padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 500;
    cursor: pointer; border: 1px solid transparent; font-family: inherit;
  }
  button.ghost { background: transparent; border-color: #2A2E35; color: #C3C8D0; }
  button.ghost:hover { background: #22262E; color: #E6E8EB; }
  button.primary { background: #E5484D; color: #fff; }
  button.primary:hover { background: #D33A3F; }
  button.primary:disabled { background: #5A2C2E; color: #9BA1AC; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid #7DB9FF; outline-offset: 2px; }

  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647; display: flex; align-items: center; gap: 14px;
    padding: 12px 18px; border-radius: 12px;
    background: #16181C; color: #E6E8EB; border: 1px solid #2A2E35;
    box-shadow: 0 12px 32px rgba(0,0,0,.45); font-size: 13px;
  }

  @media (prefers-reduced-motion: reduce) { .highlight { transition: none; } }
`;

/**
 * Erzeugt Selektor-Kandidaten für ein Element, vom spezifischsten zum breitesten.
 *
 * @param {Element} element
 * @returns {string[]}
 */
export function buildSelectorCandidates(element) {
  /** @type {string[]} */
  const candidates = [];
  const tag = element.tagName.toLowerCase();

  // Eine ID ist der beste Kandidat — sofern sie nicht generiert aussieht.
  // Zufalls-IDs wie `ad_8f3ba21` ändern sich bei jedem Seitenaufruf; eine Regel
  // darauf wäre schon beim nächsten Laden wertlos.
  const id = element.getAttribute('id');
  if (id && !looksGenerated(id)) {
    candidates.push(`#${CSS.escape(id)}`);
  }

  // Datenattribute der Werbenetzwerke sind stabil und sehr treffsicher.
  for (const attribute of element.attributes) {
    if (!attribute.name.startsWith('data-')) continue;
    if (!/ad|banner|promo|sponsor|slot/i.test(attribute.name)) continue;
    if (attribute.value && !looksGenerated(attribute.value)) {
      candidates.push(`${tag}[${attribute.name}="${CSS.escape(attribute.value)}"]`);
    } else {
      candidates.push(`${tag}[${attribute.name}]`);
    }
  }

  // Klassen: erst alle zusammen (spezifisch), dann die aussagekräftigste einzeln.
  const classes = [...element.classList].filter((name) => !looksGenerated(name));
  if (classes.length > 1) {
    candidates.push(tag + classes.map((name) => `.${CSS.escape(name)}`).join(''));
  }
  const meaningful = classes.find((name) => /ad|banner|promo|sponsor|werbung|anzeige/i.test(name));
  if (meaningful) candidates.push(`.${CSS.escape(meaningful)}`);
  if (classes.length === 1) candidates.push(`.${CSS.escape(classes[0])}`);

  // Letzter Ausweg: Pfad über die Eltern. Funktioniert immer, ist aber am
  // anfälligsten gegen Layout-Änderungen der Seite.
  candidates.push(buildStructuralPath(element));

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Erkennt generierte Bezeichner (Hashes, lange Ziffernfolgen, CSS-Module-Suffixe).
 * @param {string} value
 * @returns {boolean}
 */
export function looksGenerated(value) {
  if (value.length > 40) return true;
  if (/\d{4,}/.test(value)) return true;
  if (/^[a-z]+-[a-z0-9]{6,}$/i.test(value)) return true;
  if (/^[a-f0-9]{8,}$/i.test(value)) return true;
  return false;
}

/**
 * Baut einen Pfad-Selektor über bis zu fünf Ebenen.
 * @param {Element} element
 * @returns {string}
 */
export function buildStructuralPath(element) {
  /** @type {string[]} */
  const parts = [];
  let node = element;
  let depth = 0;

  while (node && node !== document.body && depth < 5) {
    let part = node.tagName.toLowerCase();
    const parent = node.parentElement;

    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }

    parts.unshift(part);
    node = parent;
    depth += 1;
  }

  return parts.join(' > ');
}

/**
 * Wählt den Kandidaten mit der besten Balance aus Stabilität und Treffgenauigkeit.
 *
 * @param {string[]} candidates
 * @param {Element} target
 * @returns {{selector: string, matches: number}}
 */
export function pickBestSelector(candidates, target) {
  let fallback = { selector: candidates.at(-1) ?? '*', matches: 0 };

  for (const selector of candidates) {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    // Der Kandidat muss das angeklickte Element auch wirklich treffen.
    if (![...matches].includes(target)) continue;

    // Ein Kandidat, der nur wenige Elemente trifft, ist genau das, was wir wollen:
    // treffsicher genug, um nicht die halbe Seite zu verstecken, und allgemein
    // genug, um auch bei mehreren gleichartigen Werbeplätzen zu greifen.
    if (matches.length <= 8) return { selector, matches: matches.length };
    if (fallback.matches === 0 || matches.length < fallback.matches) {
      fallback = { selector, matches: matches.length };
    }
  }

  return fallback;
}

/**
 * Zählt, wie viele Elemente ein Selektor trifft.
 * @param {string} selector
 * @returns {number} `-1` bei ungültigem Selektor.
 */
function countMatches(selector) {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

/** Baut den Shadow-Host auf. */
function mount() {
  host = document.createElement('div');
  host.id = HOST_ID;
  // `all: initial` im Shadow reicht nicht — der Host selbst erbt sonst
  // Seitenstile wie `display: none` aus breiten Selektoren.
  host.style.cssText = 'all: initial; position: static;';
  shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  document.documentElement.appendChild(host);
}

/** Entfernt den Shadow-Host. */
function unmount() {
  host?.remove();
  host = null;
  shadow = null;
  current = null;
}

/**
 * Hilfsfunktion zum Erzeugen von Elementen im Shadow Root.
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Startet den Auswahlmodus. */
function activate() {
  if (active) return;
  active = true;
  mount();

  const overlay = el('div', { class: 'overlay' });
  const highlight = el('div', { class: 'highlight', style: 'display:none' });
  const tip = el('div', { class: 'tip', style: 'display:none' });

  const bar = el('div', { class: 'bar', role: 'status' });
  bar.append(
    el('strong', {}, 'pBlock'),
    el('span', {}, 'Element anklicken, um es dauerhaft auszublenden.'),
    el('span', {}, ''),
    el('kbd', {}, 'Mausrad'),
    el('span', {}, 'übergeordnet'),
    el('kbd', {}, 'Esc'),
    el('span', {}, 'abbrechen')
  );

  shadow.append(overlay, highlight, tip, bar);

  /**
   * Ermittelt das Element unter dem Zeiger.
   *
   * Das Overlay liegt über der Seite und würde `elementFromPoint` abfangen.
   * `pointer-events: none` kurz zu setzen ist billiger als das Overlay
   * auszublenden und wieder einzublenden — v4 tat Letzteres bei *jeder*
   * Mausbewegung und erzwang damit zwei Layout-Durchläufe pro Pixel.
   *
   * @param {number} x
   * @param {number} y
   * @returns {Element|null}
   */
  function elementAt(x, y) {
    overlay.style.pointerEvents = 'none';
    const found = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = '';
    return found && found !== host ? found : null;
  }

  /**
   * Hebt ein Element hervor.
   * @param {Element|null} element
   */
  function highlightElement(element) {
    current = element;
    if (!element) {
      highlight.style.display = 'none';
      tip.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    Object.assign(highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    const { selector, matches } = pickBestSelector(buildSelectorCandidates(element), element);
    tip.replaceChildren(
      el('div', {}, selector),
      el(
        'div',
        { class: 'count' },
        matches === 1 ? '1 Treffer auf dieser Seite' : `${matches} Treffer auf dieser Seite`
      )
    );

    tip.style.display = 'block';
    const below = rect.bottom + 8;
    const fitsBelow = below + tip.offsetHeight < window.innerHeight;
    tip.style.top = `${fitsBelow ? below : Math.max(8, rect.top - tip.offsetHeight - 8)}px`;
    tip.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - tip.offsetWidth - 8)}px`;
  }

  function onMouseMove(event) {
    highlightElement(elementAt(event.clientX, event.clientY));
  }

  function onWheel(event) {
    if (!current) return;
    event.preventDefault();
    // Nach oben: zum Elternelement. Nach unten: zurück zum Element unter dem Zeiger.
    if (event.deltaY < 0 && current.parentElement && current.parentElement !== document.body) {
      highlightElement(current.parentElement);
    } else if (event.deltaY > 0) {
      highlightElement(elementAt(event.clientX, event.clientY));
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      deactivate();
      return;
    }
    // Tastaturbedienung — in v4 gar nicht vorhanden.
    if (event.key === 'ArrowUp' && current?.parentElement) {
      event.preventDefault();
      highlightElement(current.parentElement);
    }
    if (event.key === 'Enter' && current) {
      event.preventDefault();
      openDialog(current);
    }
  }

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const element = elementAt(event.clientX, event.clientY);
    if (element) openDialog(element);
  }

  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('click', onClick, true);
  overlay.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKeyDown, true);

  // Beim Scrollen der Seite wandert das Element unter dem Rahmen weg.
  window.addEventListener('scroll', () => highlightElement(current), { passive: true });

  activate.cleanup = () => {
    document.removeEventListener('keydown', onKeyDown, true);
  };
}

/**
 * Öffnet den Bestätigungsdialog.
 * @param {Element} element
 */
function openDialog(element) {
  const { selector: initial } = pickBestSelector(buildSelectorCandidates(element), element);

  const backdrop = el('div', { class: 'backdrop' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });

  const input = el('input', { type: 'text', id: 'sel', spellcheck: 'false' });
  input.value = initial;

  const hint = el('p', { class: 'hint' });
  const confirm = el('button', { class: 'primary' }, 'Ausblenden');

  /** Prüft die Eingabe und spiegelt das Ergebnis in Hinweis und Schaltfläche. */
  function validate() {
    const value = input.value.trim();
    const matches = value.length === 0 ? -1 : countMatches(value);

    if (matches < 0) {
      hint.className = 'hint error';
      hint.textContent = 'Das ist kein gültiger CSS-Selektor.';
      confirm.disabled = true;
      return;
    }
    if (matches === 0) {
      hint.className = 'hint warn';
      hint.textContent = 'Trifft auf dieser Seite derzeit nichts.';
      confirm.disabled = false;
      return;
    }
    // Ein Selektor mit sehr vielen Treffern blendet vermutlich mehr aus als
    // gewollt. Das gehört vor die Entscheidung, nicht danach.
    if (matches > 20) {
      hint.className = 'hint warn';
      hint.textContent = `Achtung: ${matches} Elemente würden ausgeblendet.`;
      confirm.disabled = false;
      return;
    }
    hint.className = 'hint ok';
    hint.textContent =
      matches === 1 ? '1 Element wird ausgeblendet.' : `${matches} Elemente werden ausgeblendet.`;
    confirm.disabled = false;
  }

  const siteOnly = el('input', { type: 'checkbox', id: 'siteonly' });
  const checkLabel = el('label', { class: 'check', for: 'siteonly' });
  const checkText = el('span', {}, 'Nur auf dieser Website');
  checkText.appendChild(el('small', {}, location.hostname));
  checkLabel.append(siteOnly, checkText);

  const cancel = el('button', { class: 'ghost' }, 'Abbrechen');

  dialog.append(
    el('h2', {}, 'Element ausblenden'),
    el(
      'p',
      { class: 'sub' },
      `${element.tagName.toLowerCase()} — ${Math.round(element.getBoundingClientRect().width)} × ${Math.round(element.getBoundingClientRect().height)} px`
    ),
    el('label', { for: 'sel' }, 'CSS-Selektor'),
    input,
    hint,
    checkLabel,
    el('div', { class: 'actions' })
  );
  dialog.querySelector('.actions').append(cancel, confirm);
  backdrop.appendChild(dialog);
  shadow.appendChild(backdrop);

  input.addEventListener('input', validate);
  validate();
  input.focus();
  input.select();

  function close() {
    backdrop.remove();
  }

  cancel.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  confirm.addEventListener('click', async () => {
    const selector = input.value.trim();
    confirm.disabled = true;
    confirm.textContent = 'Wird gespeichert …';

    try {
      const response = await chrome.runtime.sendMessage({
        type: MSG.ELEMENT_RULE_ADD,
        selector,
        siteOnly: siteOnly.checked,
        domain: location.hostname,
      });

      close();
      if (response?.ok) {
        showUndoToast();
        deactivate();
      } else {
        showErrorToast(response?.error?.message ?? 'Speichern fehlgeschlagen.');
      }
    } catch {
      close();
      showErrorToast('Die Erweiterung antwortet nicht. Bitte Seite neu laden.');
    }
  });
}

/** Zeigt die Rückgängig-Meldung. */
function showUndoToast() {
  // Der Shadow-Host wird gleich abgebaut — für die Meldung brauchen wir einen
  // eigenen, kurzlebigen Host.
  const toastHost = document.createElement('div');
  toastHost.style.cssText = 'all: initial;';
  const root = toastHost.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = 'Element ausgeblendet.';

  const undo = document.createElement('button');
  undo.className = 'ghost';
  undo.textContent = 'Rückgängig';

  toast.append(text, undo);
  root.append(style, toast);
  document.documentElement.appendChild(toastHost);

  const timer = setTimeout(() => toastHost.remove(), UNDO_TIMEOUT_MS);

  undo.addEventListener('click', async () => {
    clearTimeout(timer);
    undo.disabled = true;
    await chrome.runtime.sendMessage({ type: MSG.ELEMENT_RULE_UNDO }).catch(() => {});
    text.textContent = 'Rückgängig gemacht.';
    undo.remove();
    setTimeout(() => toastHost.remove(), 2_000);
  });
}

/**
 * Zeigt eine Fehlermeldung.
 * @param {string} message
 */
function showErrorToast(message) {
  if (!shadow) return;
  const toast = el('div', { class: 'toast', role: 'alert' });
  toast.append(el('span', {}, message));
  shadow.appendChild(toast);
  setTimeout(() => toast.remove(), 5_000);
}

/** Beendet den Auswahlmodus. */
function deactivate() {
  if (!active) return;
  active = false;
  activate.cleanup?.();
  unmount();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.PICKER_ACTIVATE) {
    activate();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === MSG.PICKER_DEACTIVATE) {
    deactivate();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
