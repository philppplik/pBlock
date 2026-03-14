// pBlock - Dynamic Cosmetic Filter Injector (Content Script)
// Runs at document_start to catch everything early

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

  // ==================== CSS INJECTION ====================

  let injectedStyle = null;
  let settings = { masterEnabled: true, categories: {}, whitelist: [] };

  // Check if current domain is whitelisted
  function isWhitelisted() {
    const whitelist = settings.whitelist || [];
    if (whitelist.length === 0) return false;
    const hostname = window.location.hostname;
    return whitelist.some(domain => hostname.includes(domain));
  }

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

    const css = selectors.join(', ') + ' { display: none !important; visibility: hidden !important; }';

    if (injectedStyle) {
      injectedStyle.textContent = css;
    } else {
      injectedStyle = document.createElement('style');
      injectedStyle.id = 'adblocker-cosmetic-rules';
      injectedStyle.textContent = css;

      // Insert at the very beginning of <head> or <html>
      if (document.documentElement) {
        document.documentElement.appendChild(injectedStyle);
      }
    }
  }

  function removeCosmeticCSS() {
    if (injectedStyle) {
      injectedStyle.remove();
      injectedStyle = null;
    }
  }

  // ==================== MUTATION OBSERVER ====================

  let observer = null;

  function isAdElement(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();
    const className = (node.className || '').toString().toLowerCase();
    const id = (node.id || '').toLowerCase();
    const src = node.getAttribute('src') || '';
    const dataAttrs = Array.from(node.attributes || [])
      .map(a => a.name + '=' + a.value).join(' ').toLowerCase();

    // Check for ad-related class names
    const adClassPatterns = ['adbox', 'banner_ads', 'adsbox', 'textads',
      'ad-banner', 'ad-container', 'ad-wrapper', 'ad-placement',
      'ad-slot', 'advertisement', 'advertising', 'sponsored',
      'promo-banner', 'adsbygoogle'];

    for (const pattern of adClassPatterns) {
      if (className.includes(pattern) || id.includes(pattern)) return true;
    }

    // Check for ad-related data attributes
    if (/data-(ad|ads|advertisement|sponsor)/.test(dataAttrs)) return true;

    // Check for ad scripts
    if (tag === 'script' && src) {
      for (const pattern of AD_SCRIPT_PATTERNS) {
        if (src.includes(pattern)) {
          console.log('[AdBlocker] Blocking ad script:', src);
          return true;
        }
      }
    }

    // Check for ad iframes
    if (tag === 'iframe' && src) {
      const adIframePatterns = ['doubleclick', 'googlesyndication',
        'adservice', 'amazon-adsystem', 'adnxs', 'ads-twitter'];
      for (const pattern of adIframePatterns) {
        if (src.includes(pattern)) return true;
      }
    }

    return false;
  }

  function hideElement(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    // For scripts, prevent execution by removing
    if (node.tagName === 'SCRIPT') {
      node.type = 'blocked/blocked'; // Prevents execution
      node.remove();
      return;
    }

    // For other elements, hide them
    node.style.setProperty('display', 'none', 'important');
    node.style.setProperty('visibility', 'hidden', 'important');
  }

  function handleMutations(mutations) {
    // Skip if whitelisted
    if (isWhitelisted()) return;

    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check the node itself
          if (isAdElement(node)) {
            hideElement(node);
          }

          // Check children recursively (for containers)
          if (node.querySelectorAll) {
            const adChildren = node.querySelectorAll(
              '[class*="adbox"], [class*="banner_ads"], [class*="adsbox"], ' +
              '[class*="textads"], [class*="ad-banner"], [class*="ad-container"], ' +
              '[class*="ad-wrapper"], [class*="advertisement"], .adsbygoogle, ' +
              'script[src*="ads.js"], script[src*="pagead.js"]'
            );
            adChildren.forEach(hideElement);
          }
        }
      }
    }
  }

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  }

  // ==================== SCRIPT BLOCKING ====================

  // Block ad scripts by overriding createElement
  function patchScriptCreation() {
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
      const element = originalCreateElement.call(this, tagName, options);

      // Skip if whitelisted
      if (isWhitelisted()) {
        return element;
      }

      if (tagName.toLowerCase() === 'script') {
        // Intercept src setting
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src') {
            for (const pattern of AD_SCRIPT_PATTERNS) {
              if (value.includes(pattern)) {
                console.log('[AdBlocker] Blocked script src:', value);
                element.type = 'blocked/blocked';
                return;
              }
            }
          }
          return originalSetAttribute.call(this, name, value);
        };

        // Also intercept direct src property
        const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        if (descriptor && descriptor.set) {
          const originalSrcSetter = descriptor.set;
          Object.defineProperty(element, 'src', {
            set: function(value) {
              for (const pattern of AD_SCRIPT_PATTERNS) {
                if (value.includes(pattern)) {
                  console.log('[AdBlocker] Blocked script src property:', value);
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
    });

    // Start observing DOM changes
    if (document.documentElement) {
      startObserver();
    } else {
      // Wait for documentElement
      const docObserver = new MutationObserver(() => {
        if (document.documentElement) {
          docObserver.disconnect();
          startObserver();
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
