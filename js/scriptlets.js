// pBlock - Scriptlet Injection
// Anti-adblocker defusing scripts
// Adapted from @cliqz/adblocker and uBlock Origin scriptlet patterns

(function() {
  'use strict';

  const LOG_PREFIX = '[pBlock Scriptlets]';

  // ==================== SCRIPTLET DEFINITIONS ====================

  const SCRIPTLETS = {

    /**
     * BlockAdBlock / FuckAdBlock / BlockAdblock defuser
     * Prevents these libraries from detecting ad blockers
     */
    'nobab.js': `
      (function() {
        // Defuse BlockAdBlock
        if (typeof window.BlockAdBlock === 'function') {
          window.BlockAdBlock = function() { return true; };
          window.blockAdBlock = function() { return true; };
        }

        // Defuse FuckAdBlock
        if (typeof window.fuckAdBlock === 'function') {
          window.fuckAdBlock = function() { return true; };
          window.FuckAdBlock = function() { return true; };
        }

        // Defuse common ad blocker detection patterns
        const noop = function() { return true; };
        const noopObj = { check: noop, on: noop, off: noop };

        // Override common detection function names
        const detectionNames = [
          'canRunAds', 'isAdBlockActive', 'adBlockEnabled',
          'AdBlockDetector', 'adBlockDetector', 'adbDetect'
        ];

        for (const name of detectionNames) {
          if (window[name] !== undefined) {
            window[name] = name.includes('Detector') ? function() { return noopObj; } : noop;
          }
        }

        // Prevent ad blocker warning overlays
        const overlaySelectors = [
          '[class*="adblock"]', '[id*="adblock"]',
          '[class*="ad-block"]', '[id*="ad-block"]',
          '[class*="adblocker"]', '[id*="adblocker"]',
          '.ab-message', '#ab-message',
          '.adb-warning', '#adb-warning'
        ];

        const hideOverlays = function() {
          for (const selector of overlaySelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              // Only hide if it looks like a warning (small text, overlay, etc.)
              const text = (el.textContent || '').toLowerCase();
              if (text.includes('adblock') || text.includes('ad blocker') || text.includes('please disable')) {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
              }
            }
          }
        };

        // Run on DOM ready and observe for late additions
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', hideOverlays);
        } else {
          hideOverlays();
        }

        const observer = new MutationObserver(hideOverlays);
        if (document.documentElement) {
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        console.log('[pBlock] nobab scriptlet loaded');
      })();
    `,

    /**
     * Defuse ad blocker detection via script loading
     * Some sites try to load ad scripts and check if they loaded
     */
    'noad.js': `
      (function() {
        // Fake ad-related globals that detection scripts look for
        const fakeAdObjects = {
          'google_ad_client': 'pub-0000000000000000',
          'google_ad_width': 728,
          'google_ad_height': 90,
          'google_ad_format': '728x90_as',
          'googletag': { cmd: [], _loaded: true },
          'adsbygoogle': { loaded: true, push: function() {} },
          '_gaq': { push: function() {} },
          'ga': function() { return true; },
          'gtag': function() { return true; }
        };

        for (const [key, value] of Object.entries(fakeAdObjects)) {
          if (window[key] === undefined) {
            try {
              Object.defineProperty(window, key, {
                value: value,
                writable: false,
                configurable: false
              });
            } catch(e) {
              window[key] = value;
            }
          }
        }

        // Defuse ad slot detection
        if (!window.googletag) {
          window.googletag = { cmd: [], _loaded: true };
        }

        console.log('[pBlock] noad scriptlet loaded');
      })();
    `,

    /**
     * Remove "Please disable ad blocker" overlay popups
     * Specifically targets common anti-adblock overlay patterns
     */
    'nowoar.js': `
      (function() {
        const adblockPhrases = [
          'please disable your ad blocker',
          'disable adblock',
          'turn off your ad blocker',
          'ad blocker detected',
          'whitelist us',
          'support us by disabling',
          'ad blocker interference detected',
          'please support us by disabling',
          'ads are important for',
          'we noticed you are using an adblocker'
        ];

        function isAdblockOverlay(el) {
          const text = (el.textContent || '').toLowerCase();
          const role = el.getAttribute('role') || '';
          const style = window.getComputedStyle(el);

          // Check if text contains adblock phrases
          const hasAdblockText = adblockPhrases.some(phrase => text.includes(phrase));

          // Check if it's an overlay/modal
          const isOverlay = (
            style.position === 'fixed' ||
            style.position === 'absolute' ||
            el.classList.contains('modal') ||
            el.classList.contains('overlay') ||
            role === 'dialog' ||
            role === 'alertdialog'
          );

          return hasAdblockText && isOverlay;
        }

        function removeOverlays() {
          // Check common overlay containers
          const candidates = document.querySelectorAll(
            'div[class*="modal"], div[class*="overlay"], div[class*="popup"], ' +
            'div[role="dialog"], div[role="alertdialog"], ' +
            'div[class*="backdrop"], div[class*="lightbox"]'
          );

          for (const el of candidates) {
            if (isAdblockOverlay(el)) {
              console.log('[pBlock] Removing adblock overlay:', el.className || el.id);
              el.remove();
            }
          }

          // Also check fixed position elements with adblock text
          const allElements = document.querySelectorAll('div, section, aside');
          for (const el of allElements) {
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'absolute') {
              if (isAdblockOverlay(el)) {
                console.log('[pBlock] Removing fixed adblock overlay:', el.className || el.id);
                el.remove();
              }
            }
          }
        }

        // Remove body overflow:hidden that locks scroll
        function restoreScroll() {
          const html = document.documentElement;
          const body = document.body;

          if (html) {
            html.style.setProperty('overflow', 'auto', 'important');
            html.style.setProperty('position', 'static', 'important');
          }
          if (body) {
            body.style.setProperty('overflow', 'auto', 'important');
            body.style.setProperty('position', 'static', 'important');
          }
        }

        // Run on load and observe
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            removeOverlays();
            restoreScroll();
          });
        } else {
          removeOverlays();
          restoreScroll();
        }

        // Observe for late additions
        const observer = new MutationObserver(() => {
          removeOverlays();
          restoreScroll();
        });

        if (document.documentElement) {
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true
          });
        }

        console.log('[pBlock] nowoar scriptlet loaded');
      })();
    `,

    /**
     * Defuse eval-based ad detection
     * Some sites use eval/setTimeout to detect ad blockers
     */
    'noeval.js': `
      (function() {
        const originalEval = window.eval;

        window.eval = function(code) {
          // Block eval calls that contain ad detection patterns
          if (typeof code === 'string') {
            const lowerCode = code.toLowerCase();
            if (
              lowerCode.includes('adblock') ||
              lowerCode.includes('adblocker') ||
              lowerCode.includes('ad-block') ||
              lowerCode.includes('canRunAds') ||
              lowerCode.includes('isAdBlockActive')
            ) {
              console.log('[pBlock] Blocked eval for ad detection:', code.substring(0, 100));
              return undefined;
            }
          }
          return originalEval.call(window, code);
        };

        // Also patch Function constructor
        const OriginalFunction = window.Function;
        window.Function = function(...args) {
          const code = args[args.length - 1];
          if (typeof code === 'string') {
            const lowerCode = code.toLowerCase();
            if (
              lowerCode.includes('adblock') ||
              lowerCode.includes('adblocker') ||
              lowerCode.includes('ad-block')
            ) {
              console.log('[pBlock] Blocked Function() for ad detection');
              return function() {};
            }
          }
          return OriginalFunction.apply(window, args);
        };
        window.Function.prototype = OriginalFunction.prototype;

        console.log('[pBlock] noeval scriptlet loaded');
      })();
    `
  };

  // ==================== SCRIPT INJECTION ====================

  /**
   * Wrap script to auto-remove after execution
   * @param {string} script - Script code to wrap
   * @returns {string} - Wrapped script code
   */
  function autoRemoveScript(script) {
    return `try{${script}}catch(c){console.warn('[pBlock] Scriptlet error:',c);}!function(){var c=document.currentScript,e=c&&c.parentNode;e&&e.removeChild(c)}();`;
  }

  /**
   * Inject a scriptlet into the page using CSP-compliant method
   * @param {string} name - Scriptlet name
   * @param {Document} doc - Document to inject into (unused, kept for compatibility)
   */
  function injectScriptlet(name, doc) {
    const scriptlet = SCRIPTLETS[name];
    if (!scriptlet) {
      console.warn(`${LOG_PREFIX} Unknown scriptlet: ${name}`);
      return;
    }

    try {
      // Use chrome.scripting.executeScript via background script for CSP compliance
      chrome.runtime.sendMessage({
        type: 'executeScriptlet',
        code: autoRemoveScript(scriptlet)
      }, (response) => {
        if (response?.success) {
          console.log(`${LOG_PREFIX} Injected: ${name}`);
        } else {
          console.error(`${LOG_PREFIX} Failed to inject ${name}:`, response?.error || 'Unknown error');
        }
      });
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to inject ${name}:`, e);
    }
  }

  /**
   * Inject multiple scriptlets
   * @param {string[]} names - Array of scriptlet names
   * @param {Document} doc - Document to inject into
   */
  function injectScriptlets(names, doc) {
    for (const name of names) {
      injectScriptlet(name, doc);
    }
  }

  /**
   * Get scriptlet by name
   * @param {string} name - Scriptlet name
   * @returns {string|undefined} - Scriptlet code
   */
  function getScriptlet(name) {
    return SCRIPTLETS[name];
  }

  /**
   * Get all available scriptlet names
   * @returns {string[]} - Array of scriptlet names
   */
  function getAvailableScriptlets() {
    return Object.keys(SCRIPTLETS);
  }

  // ==================== EXPORT ====================

  window.PBlockScriptlets = {
    SCRIPTLETS,
    injectScriptlet,
    injectScriptlets,
    getScriptlet,
    getAvailableScriptlets
  };

  console.log(`${LOG_PREFIX} Module loaded with ${Object.keys(SCRIPTLETS).length} scriptlets`);
})();
