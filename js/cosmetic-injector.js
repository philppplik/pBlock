// pBlock - Dynamic Cosmetic Filter Injector (Content Script)
// Runs at document_start to catch everything early
// Integrates DOM Monitor for MutationObserver + Scriptlets for anti-adblock

(function() {
  'use strict';

  // ==================== CONFIGURATION ====================

  // Generic ad selectors - matches most common ad patterns
  const GENERIC_AD_SELECTORS = [
    // Common ad class patterns
    '.adbox', '.banner_ads', '.adsbox', '.textads',
    '.ad-banner', '.ad-container', '.ad-wrapper', '.ad-placement',
    '.ad-slot', '.advertisement', '.advertising', '.ad-unit',
    '.ad-label', '.ad-tag', '.ad-box', '.ad-block',
    '.ad-section', '.ad-row', '.ad-column', '.ad-zone',
    '[class*="ad-container"]', '[class*="ad-wrapper"]',
    '[class*="ad-banner"]', '[class*="ad-placement"]',
    '[class*="ad-slot"]', '[class*="advertisement"]',
    '[class*="advertising"]', '[class*="sponsored-content"]',
    '[class*="sponsored-post"]', '[class*="promo-banner"]',
    '[class*="promo-container"]',
    // ID patterns
    '[id*="ad-container"]', '[id*="ad-wrapper"]',
    '[id*="ad-banner"]', '[id*="google_ads"]',
    // Google AdSense
    'ins.adsbygoogle', '.adsbygoogle',
    'div[id^="div-gpt-ad"]', 'div[id^="google_ads"]',
    // Data attributes
    '[data-ad]', '[data-ad-slot]', '[data-ad-unit]',
    '[data-google-query-id]',
    // Iframes from ad networks
    'iframe[id*="google_ads"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="adservice.google"]',
    // Specific test site selectors (adblock.turtlecute.org)
    '#ad-banner', '#ad-container', '#ad-wrapper',
    // Display ad patterns
    '[id^="ad_"]', '[id^="ads_"]',
    '[class^="ad_"]', '[class^="ads_"]',
    // Empty ad placeholders
    'div[style*="min-height: 250px"][style*="min-width: 300px"]',
    'div[style*="min-height:250px"][style*="min-width:300px"]'
  ];

  // Social widget selectors
  const SOCIAL_SELECTORS = [
    '.fb-like', '.fb-page', '.fb-root:not(:empty)',
    '.twitter-follow-button', '.twitter-share-button',
    '.twitter-timeline',
    '.pinterest-widget', '.linkedin-widget',
    '[data-widget="social"]'
  ];

  // Tracking pixel selectors
  const TRACKING_SELECTORS = [
    'img[width="1"][height="1"]',
    'img[width="0"][height="0"]',
    'iframe[width="1"][height="1"]',
    'iframe[width="0"][height="0"]'
  ];

  // Ad script URL patterns
  const AD_SCRIPT_PATTERNS = [
    // Test site scripts
    'ads.js', 'pagead.js',
    // Common ad script paths
    '/ads.js', '/ad.js', '/advert.js',
    '/pagead/', '/pagead.js',
    '/adsbygoogle', '/adserver',
    '/adsystem/', '/adnxs.',
    '/googlesyndication', '/adservice',
    '/doubleclick', '/googletag',
    // Ad network scripts
    'adsbygoogle', 'adservice.google',
    'googlesyndication', 'doubleclick',
    'amazon-adsystem', 'ads-twitter',
    'connect.facebook.net', 'pixel.facebook',
    'taboola', 'outbrain'
  ];

  // ==================== STATE ====================

  let injectedStyle = null;
  let settings = { masterEnabled: true, categories: {}, whitelist: [] };
  let domMonitor = null;
  let adSelectorsForMatching = [];
  let hiddenElements = new WeakSet(); // Track already-hidden elements
  let blockCount = 0;
  let statsFlushTimer = null;
  const STATS_FLUSH_INTERVAL = 2000; // Send stats every 2 seconds

  // ==================== WHITELIST ====================

  function isWhitelisted() {
    const whitelist = settings.whitelist || [];
    if (whitelist.length === 0) return false;
    const hostname = window.location.hostname;
    return whitelist.some(domain => hostname.includes(domain));
  }

  // ==================== CSS INJECTION ====================

  function getActiveSelectors() {
    if (!settings.masterEnabled) return [];
    if (isWhitelisted()) return [];

    const selectors = [];
    const categories = settings.categories || {};

    if (categories.ads?.enabled !== false) {
      selectors.push(...GENERIC_AD_SELECTORS);
    }
    if (categories.social?.enabled !== false) {
      selectors.push(...SOCIAL_SELECTORS);
    }
    if (categories.analytics?.enabled !== false) {
      selectors.push(...TRACKING_SELECTORS);
    }

    return selectors;
  }

  function injectCosmeticCSS() {
    const selectors = getActiveSelectors();
    if (selectors.length === 0) {
      removeCosmeticCSS();
      return;
    }

    // Cache selectors for DOM Monitor element matching
    adSelectorsForMatching = selectors;

    const css = selectors.join(', ') + ' { display: none !important; visibility: hidden !important; }';

    if (injectedStyle) {
      injectedStyle.textContent = css;
    } else {
      injectedStyle = document.createElement('style');
      injectedStyle.id = 'adblocker-cosmetic-rules';
      injectedStyle.textContent = css;

      if (document.documentElement) {
        document.documentElement.appendChild(injectedStyle);
      }
    }

    // Count elements that were hidden by CSS injection
    countInitiallyHiddenElements(selectors);
  }

  function countInitiallyHiddenElements(selectors) {
    // Count matching elements for stats (batch count)
    let count = 0;
    for (const selector of selectors) {
      try {
        const matches = document.querySelectorAll(selector);
        for (const el of matches) {
          if (!hiddenElements.has(el)) {
            hiddenElements.add(el);
            count++;
          }
        }
      } catch (e) {}
    }

    if (count > 0) {
      blockCount += count;
      scheduleFlushStats();
    }
  }

  function removeCosmeticCSS() {
    if (injectedStyle) {
      injectedStyle.remove();
      injectedStyle = null;
    }
    adSelectorsForMatching = [];
  }

  // ==================== DOM MONITOR INTEGRATION ====================

  /**
   * Callback for DOM Monitor — handles newly added elements
   * This catches dynamically injected ads that appear after initial CSS injection
   */
  function onDOMMonitorEvent(event) {
    if (event.type !== 'elements') return;
    if (isWhitelisted()) return;
    if (!settings.masterEnabled) return;
    if (adSelectorsForMatching.length === 0) return;

    let didHide = false;

    // For each new element, check if it or its children match ad selectors
    for (const el of event.elements) {
      if (el.nodeType !== 1) continue;

      // Check the element itself against all selectors
      for (const selector of adSelectorsForMatching) {
        try {
          if (el.matches(selector)) {
            hideElement(el);
            didHide = true;
            break;
          }
        } catch (e) {
          // Invalid selector, skip
        }
      }

      // Check children
      if (el.querySelectorAll) {
        for (const selector of adSelectorsForMatching) {
          try {
            const matches = el.querySelectorAll(selector);
            if (matches.length > 0) {
              matches.forEach(hideElement);
              didHide = true;
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }
      }
    }

    // Schedule stats flush if we hid anything
    if (didHide) {
      scheduleFlushStats();
    }
  }

  function hideElement(node) {
    if (node.nodeType !== 1) return;

    // Skip if already hidden by us
    if (hiddenElements.has(node)) return;
    hiddenElements.add(node);

    // Track block for stats
    blockCount++;

    // For scripts, prevent execution by removing
    if (node.tagName === 'SCRIPT') {
      node.type = 'blocked/blocked';
      node.remove();
      return;
    }

    node.style.setProperty('display', 'none', 'important');
    node.style.setProperty('visibility', 'hidden', 'important');
  }

  // ==================== STATS TRACKING ====================

  function scheduleFlushStats() {
    if (statsFlushTimer) return;
    statsFlushTimer = setTimeout(flushStats, STATS_FLUSH_INTERVAL);
  }

  function flushStats() {
    statsFlushTimer = null;
    if (blockCount === 0) return;

    const countToSend = blockCount;
    blockCount = 0;

    chrome.runtime.sendMessage({
      type: 'recordCosmeticBlocks',
      count: countToSend,
      domain: window.location.hostname
    }).catch(() => {
      // Background might not be ready, keep the count
      blockCount += countToSend;
    });
  }

  function startDOMMonitor() {
    if (typeof window.PBlockDOMMonitor === 'undefined') {
      console.warn('[pBlock] DOM Monitor not available, falling back to basic observer');
      startFallbackObserver();
      return;
    }

    domMonitor = new window.PBlockDOMMonitor.DOMMonitor(onDOMMonitorEvent);
    domMonitor.start(window);

    // Run initial query to catch elements already in DOM
    domMonitor.queryAll(window);
  }

  function stopDOMMonitor() {
    if (domMonitor) {
      domMonitor.stop();
      domMonitor = null;
    }
  }

  // Fallback basic observer if DOM Monitor fails to load
  let fallbackObserver = null;

  function startFallbackObserver() {
    if (fallbackObserver) return;

    fallbackObserver = new MutationObserver((mutations) => {
      if (isWhitelisted()) return;
      if (adSelectorsForMatching.length === 0) return;

      let didHide = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          for (const selector of adSelectorsForMatching) {
            try {
              if (node.matches(selector)) {
                hideElement(node);
                didHide = true;
                break;
              }
            } catch (e) {}
          }

          if (node.querySelectorAll) {
            for (const selector of adSelectorsForMatching) {
              try {
                const matches = node.querySelectorAll(selector);
                if (matches.length > 0) {
                  matches.forEach(hideElement);
                  didHide = true;
                }
              } catch (e) {}
            }
          }
        }
      }

      if (didHide) {
        scheduleFlushStats();
      }
    });

    fallbackObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  }

  // ==================== SCRIPTLET INJECTION ====================

  function injectScriptlets() {
    if (typeof window.PBlockScriptlets === 'undefined') {
      console.warn('[pBlock] Scriptlets module not available');
      return;
    }

    if (!settings.masterEnabled || isWhitelisted()) return;

    const categories = settings.categories || {};
    const scriptletsToInject = [];

    // Anti-adblock scriptlets for ads category
    if (categories.ads?.enabled !== false) {
      scriptletsToInject.push('nobab.js', 'noad.js', 'nowoar.js');
    }

    // Anti-detection scriptlets for analytics category
    if (categories.analytics?.enabled !== false) {
      scriptletsToInject.push('noeval.js');
    }

    if (scriptletsToInject.length > 0) {
      window.PBlockScriptlets.injectScriptlets(scriptletsToInject, document);
    }
  }

  // ==================== SCRIPT BLOCKING ====================

  function patchScriptCreation() {
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
      const element = originalCreateElement.call(this, tagName, options);

      if (isWhitelisted()) {
        return element;
      }

      if (tagName.toLowerCase() === 'script') {
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src') {
            for (const pattern of AD_SCRIPT_PATTERNS) {
              if (value.includes(pattern)) {
                console.log('[pBlock] Blocked script src:', value);
                element.type = 'blocked/blocked';
                return;
              }
            }
          }
          return originalSetAttribute.call(this, name, value);
        };

        const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        if (descriptor && descriptor.set) {
          const originalSrcSetter = descriptor.set;
          Object.defineProperty(element, 'src', {
            set: function(value) {
              for (const pattern of AD_SCRIPT_PATTERNS) {
                if (value.includes(pattern)) {
                  console.log('[pBlock] Blocked script src property:', value);
                  element.type = 'blocked/blocked';
                  return;
                }
              }
              originalSrcSetter.call(this, value);
            },
            get: descriptor.get,
            configurable: true
          });
        }
      }

      return element;
    };
  }

  // ==================== INITIALIZATION ====================

  function init() {
    // Request settings from background
    chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
      if (response && !chrome.runtime.lastError) {
        settings = response;
      }
      injectCosmeticCSS();
      injectScriptlets();
    });

    // Start DOM Monitor for dynamic element detection
    if (document.documentElement) {
      startDOMMonitor();
    } else {
      const docObserver = new MutationObserver(() => {
        if (document.documentElement) {
          docObserver.disconnect();
          startDOMMonitor();
        }
      });
      docObserver.observe(document, { childList: true });
    }

    // Patch script creation to block ad scripts
    patchScriptCreation();
  }

  // Listen for settings updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'updateSettings') {
      settings = message.settings;
      injectCosmeticCSS();

      // Re-inject scriptlets if settings changed significantly
      // (only if monitor was already running, meaning page is loaded)
      if (domMonitor) {
        injectScriptlets();
      }

      sendResponse({ success: true });
    }
  });

  // Start immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
