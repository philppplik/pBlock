/**
 * Skript für die **Hauptwelt** der Seite.
 *
 * ## Warum diese Datei existiert
 *
 * v4 wollte dasselbe erreichen und ging dabei einen Weg, den der Chrome Web Store
 * praktisch sicher ablehnt: Das Content-Script schickte Skript-Quelltext als
 * String an den Service Worker, der ihn per `chrome.scripting.executeScript` in
 * eine Funktion mit `eval(code)` hineinreichte. Das ist dynamische Codeausführung
 * — genau das, was Manifest V3 unterbinden soll — und kostete für jeden einzelnen
 * Scriptlet eine Nachricht plus einen Injektionsvorgang.
 *
 * Seit Chrome 111 kann ein Content-Script im Manifest direkt mit
 * `"world": "MAIN"` registriert werden. Der Code liegt damit als ganz normale
 * Datei im Paket, wird statisch geprüft und läuft ohne `eval`.
 *
 * ## Zurückhaltung ist Absicht
 *
 * Alles hier greift in fremde Seiten ein. Jeder Eingriff ist ein Risiko, eine
 * funktionierende Seite zu beschädigen. Deshalb: kein Blindverstecken, keine
 * Überschreibung von `eval` oder `Function` (v4 tat beides und brach damit
 * legitime Anwendungen), sondern nur eng umrissene Gegenmaßnahmen gegen bekannte
 * Adblock-Erkennung.
 */

(() => {
  'use strict';

  /** Wird vom Build ersetzt; erlaubt dem Content-Script, uns abzuschalten. */
  const FLAG = '__pblockMainWorldReady';
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true, configurable: false, enumerable: false });

  /**
   * Legt eine Eigenschaft möglichst unauffällig fest.
   *
   * Erkennungsskripte prüfen teilweise, ob eine Eigenschaft überhaupt
   * überschreibbar ist. `defineProperty` mit `configurable: false` fällt dabei
   * auf; ein einfaches Setzen nicht.
   *
   * @param {string} name
   * @param {unknown} value
   */
  function defineQuietly(name, value) {
    if (name in window) return;
    try {
      Object.defineProperty(window, name, {
        get: () => value,
        set: () => {},
        configurable: true,
        enumerable: false,
      });
    } catch {
      try {
        window[name] = value;
      } catch {
        // Die Seite hat die Eigenschaft gesperrt. Dann eben nicht.
      }
    }
  }

  const noop = () => {};

  /**
   * Stellt die Platzhalter bereit, die typische Werbeskripte erwarten.
   *
   * Viele Seiten prüfen nicht „läuft ein Adblocker“, sondern „ist `adsbygoogle`
   * vorhanden“. Ein harmloser Platzhalter beantwortet das mit Ja, ohne dass
   * tatsächlich Werbung geladen wird.
   */
  function installAdPlaceholders() {
    defineQuietly('adsbygoogle', Object.assign([], { loaded: true, push: noop }));
    defineQuietly('googletag', {
      cmd: { push: (fn) => (typeof fn === 'function' ? undefined : undefined) },
      apiReady: true,
      pubadsReady: true,
      pubads: () => ({
        addEventListener: noop,
        removeEventListener: noop,
        refresh: noop,
        enableSingleRequest: noop,
        setTargeting: noop,
        getSlots: () => [],
      }),
      defineSlot: () => ({ addService: () => ({ setTargeting: noop }) }),
      enableServices: noop,
      display: noop,
    });
    defineQuietly('canRunAds', true);
    defineQuietly('isAdBlockActive', false);
  }

  /**
   * Entschärft die verbreiteten Erkennungsbibliotheken.
   *
   * BlockAdBlock und FuckAdBlock melden über Rückrufe, ob Werbung geladen wurde.
   * Sie zu ersetzen ist verlässlicher, als ihr Ergebnis im Nachhinein zu
   * kaschieren.
   */
  function defuseDetectors() {
    const stub = function () {
      return {
        check: () => true,
        onDetected: noop,
        onNotDetected: (callback) => {
          if (typeof callback === 'function') {
            // Asynchron aufrufen, damit sich das Verhalten wie ein echter,
            // erfolgreicher Ladevorgang anfühlt.
            setTimeout(callback, 0);
          }
          return this;
        },
        setOption: noop,
        clearEvent: noop,
      };
    };

    for (const name of ['BlockAdBlock', 'blockAdBlock', 'FuckAdBlock', 'fuckAdBlock']) {
      defineQuietly(name, stub());
    }
  }

  /**
   * Gibt den Seitenaufbau frei, wenn eine Erkennungsschicht ihn blockiert hat.
   *
   * Bewusst eng gefasst: Es wird nur eingegriffen, wenn das Scrollen tatsächlich
   * gesperrt ist **und** ein Element mit passendem Hinweistext existiert. v4
   * setzte `overflow: auto` bedingungslos auf `html` und `body` — und zerschoss
   * damit jede Seite, die eine eigene Scroll-Mechanik verwendet.
   */
  function releaseScrollLockIfBlocked() {
    const body = document.body;
    if (!body) return;

    const style = getComputedStyle(body);
    const isLocked = style.overflow === 'hidden' || style.position === 'fixed';
    if (!isLocked) return;

    const text = (body.innerText || '').toLowerCase().slice(0, 4_000);
    const phrases = [
      'adblocker',
      'ad blocker',
      'werbeblocker',
      'adblock',
      'deaktiviere deinen',
      'disable your ad',
      'please disable',
    ];
    if (!phrases.some((phrase) => text.includes(phrase))) return;

    body.style.setProperty('overflow', 'auto', 'important');
    document.documentElement.style.setProperty('overflow', 'auto', 'important');
  }

  /**
   * Wartet auf `document.body` und prüft dann einmalig die Scroll-Sperre.
   */
  function scheduleScrollCheck() {
    const run = () => {
      try {
        releaseScrollLockIfBlocked();
      } catch {
        // Der Eingriff ist optional; ein Fehler darf die Seite nicht stören.
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
    // Viele Erkennungsschichten greifen erst nach dem Laden aller Ressourcen.
    window.addEventListener('load', run, { once: true });
  }

  try {
    installAdPlaceholders();
    defuseDetectors();
    scheduleScrollCheck();
  } catch {
    // Unter keinen Umständen die Seite mit einem geworfenen Fehler belasten.
  }
})();
