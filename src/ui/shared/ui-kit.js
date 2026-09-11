/**
 * Gemeinsame Helfer für alle Oberflächen der Erweiterung.
 *
 * Enthält bewusst kein Framework. Popup und Einstellungsseite haben einen
 * überschaubaren Zustand; ein Framework würde hier vor allem Ladezeit kosten —
 * und das Popup muss sofort da sein, wenn man auf das Symbol klickt.
 */

import { LIVE_PORT_NAME } from '../../core/messages.js';

/**
 * Schickt eine Nachricht an den Service Worker.
 *
 * Der Rückgabewert ist immer `{ok, data}` bzw. `{ok, error}` — auch dann, wenn
 * die Verbindung selbst scheitert. Aufrufer müssen also nie zwischen „Handler
 * hat einen Fehler gemeldet“ und „Nachricht kam gar nicht an“ unterscheiden.
 *
 * @param {string} type
 * @param {object} [payload]
 * @returns {Promise<{ok: boolean, data?: any, error?: {message: string, code: string}}>}
 */
export async function send(type, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response) {
      return {
        ok: false,
        error: { message: 'Die Erweiterung hat nicht geantwortet.', code: 'NO_RESPONSE' },
      };
    }
    return response;
  } catch (error) {
    return {
      ok: false,
      error: {
        message:
          error instanceof Error && error.message.includes('Receiving end does not exist')
            ? 'Der Hintergrunddienst startet gerade. Bitte kurz erneut versuchen.'
            : 'Verbindung zur Erweiterung fehlgeschlagen.',
        code: 'DISCONNECTED',
      },
    };
  }
}

/**
 * Öffnet die Verbindung für Live-Aktualisierungen.
 *
 * @param {(message: {type: string, payload: unknown}) => void} onMessage
 * @returns {() => void} Funktion zum Schließen.
 */
export function connectLive(onMessage) {
  let port = null;
  let closed = false;

  const open = () => {
    if (closed) return;
    try {
      port = chrome.runtime.connect({ name: LIVE_PORT_NAME });
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        port = null;
        // Der Service Worker wurde beendet. Erneut verbinden, sofern die Seite
        // noch offen ist — sonst bleiben die Zahlen ab hier stehen.
        if (!closed && document.visibilityState === 'visible') {
          setTimeout(open, 1_000);
        }
      });
    } catch {
      if (!closed) setTimeout(open, 2_000);
    }
  };

  open();

  return () => {
    closed = true;
    port?.disconnect();
  };
}

/**
 * Kürzel für `document.querySelector` mit Typhinweis.
 * @template {Element} T
 * @param {string} selector
 * @param {ParentNode} [scope=document]
 * @returns {T|null}
 */
export function $(selector, scope = document) {
  return /** @type {T|null} */ (scope.querySelector(selector));
}

/**
 * Erzeugt ein Element.
 *
 * Bewusst ohne `innerHTML`: In v4 wurden Nutzerwerte (Selektoren, Domains) per
 * Template-String in `innerHTML` geschrieben. Das ist der klassische Weg zu
 * eingeschleustem Markup in der eigenen Erweiterungsseite.
 *
 * @param {string} tag
 * @param {{class?: string, text?: string, attrs?: Record<string, string>, children?: Node[]}} [options]
 * @returns {HTMLElement}
 */
export function h(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(key, value);
  }
  for (const child of options.children ?? []) node.appendChild(child);
  return node;
}

/**
 * Baut einen beschrifteten Schalter.
 * @param {{id: string, checked: boolean, label: string, disabled?: boolean}} options
 * @returns {{root: HTMLElement, input: HTMLInputElement}}
 */
export function buildSwitch({ id, checked, label, disabled = false }) {
  const input = /** @type {HTMLInputElement} */ (
    h('input', { attrs: { type: 'checkbox', id, 'aria-label': label } })
  );
  input.checked = checked;
  input.disabled = disabled;

  const root = h('span', {
    class: 'switch',
    children: [input, h('span', { class: 'switch__track' })],
  });

  return { root, input };
}

/**
 * Zeigt eine kurze Rückmeldung am unteren Rand.
 *
 * Ersetzt die `alert()`-Aufrufe aus v4. Ein modaler Systemdialog für „Import
 * erfolgreich“ ist im Jahr 2026 keine angemessene Rückmeldung mehr.
 *
 * @param {string} message
 * @param {'ok'|'error'|'info'} [tone='info']
 */
export function toast(message, tone = 'info') {
  let container = $('#toast-area');
  if (!container) {
    container = h('div', { attrs: { id: 'toast-area', role: 'status', 'aria-live': 'polite' } });
    document.body.appendChild(container);
  }

  const item = h('div', { class: `toast toast--${tone}`, text: message });
  container.appendChild(item);

  setTimeout(() => {
    item.classList.add('toast--leaving');
    setTimeout(() => item.remove(), 200);
  }, 3_500);
}

/**
 * Fragt eine Bestätigung ab.
 *
 * Nutzt bewusst `window.confirm`: Für eine einzelne, seltene Ja/Nein-Frage ist
 * ein eigener Dialog mit Fokusfalle und Tastaturbedienung mehr Code als Nutzen —
 * und der Systemdialog ist für Bildschirmleser einwandfrei bedienbar.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function confirmAction(message) {
  return window.confirm(message);
}

/**
 * Wendet das Farbschema an.
 * @param {{theme: string, reduceMotion: boolean}} ui
 */
export function applyTheme(ui) {
  const root = document.documentElement;
  if (ui.theme === 'dark' || ui.theme === 'light') root.dataset.theme = ui.theme;
  else delete root.dataset.theme;

  root.dataset.reduceMotion = String(Boolean(ui.reduceMotion));
}

/**
 * Formatiert einen Zeitpunkt als relative Angabe auf Deutsch.
 * @param {number|null} timestamp Epoch-Millisekunden.
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return 'nie';

  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 60) return 'gerade eben';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;

  return new Date(timestamp).toLocaleDateString('de-DE');
}

/**
 * Löst einen Datei-Download aus.
 * @param {string} filename
 * @param {string} content
 * @param {string} [mimeType='application/json']
 */
export function downloadFile(filename, content, mimeType = 'application/json') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = h('a', { attrs: { href: url, download: filename } });
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Der Blob bleibt sonst bis zum Schließen der Seite im Speicher.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Liest eine vom Nutzer gewählte Datei als Text.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsText(file);
  });
}
