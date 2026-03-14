// pBlock - Cosmetic Filtering
// Hides ad elements via CSS injection

const CosmeticFilter = {
  // Default cosmetic rules (CSS selectors to hide)
  rules: {
    // Generic ad selectors
    generic: [
      // Test site specific selectors (adblock.turtlecute.org)
      '.adbox',
      '.banner_ads',
      '.adsbox',
      '.textads',
      // Common ad class patterns
      '[id*="ad-container"]',
      '[id*="ad-wrapper"]',
      '[id*="ad-banner"]',
      '[id*="google_ads"]',
      '[class*="ad-container"]',
      '[class*="ad-wrapper"]',
      '[class*="ad-banner"]',
      '[class*="ad-placement"]',
      '[class*="ad-slot"]',
      '[class*="advertisement"]',
      '[class*="advertising"]',
      '[class*="sponsored-content"]',
      '[class*="sponsored-post"]',
      '[class*="promo-banner"]',
      '[class*="promo-container"]',
      'iframe[id*="google_ads"]',
      'iframe[src*="doubleclick.net"]',
      'iframe[src*="googlesyndication"]',
      'div[id^="div-gpt-ad"]',
      'ins.adsbygoogle',
      '.adsbygoogle',
      '[data-ad]',
      '[data-ad-slot]',
      '[data-ad-unit]',
      '[data-google-query-id]',
      '.ad-placement',
      '.ad-slot',
      '.ad-banner',
      '.ad-container',
      '.ad-wrapper',
      '#ad-container',
      '#ad-wrapper',
      '#ad-banner'
    ],

    // Social widgets
    social: [
      '.fb-like',
      '.fb-page',
      '.twitter-follow-button',
      '.twitter-share-button',
      '.twitter-timeline',
      '.pinterest-widget',
      '.linkedin-widget',
      '[data-widget="social"]'
    ],

    // Tracking pixel containers
    tracking: [
      'img[width="1"][height="1"]',
      'img[width="0"][height="0"]',
      'iframe[width="1"][height="1"]',
      'iframe[width="0"][height="0"]'
    ],

    // Annoyances
    annoyances: [
      '.cookie-banner',
      '.cookie-notice',
      '.cookie-consent',
      '.cookie-banner-container',
      '#cookie-banner',
      '#cookie-notice',
      '#cookie-consent',
      '[class*="cookie-banner"]',
      '[class*="cookie-notice"]',
      '[class*="cookie-consent"]',
      '[class*="cookie-popup"]',
      '[class*="newsletter-popup"]',
      '[class*="subscription-popup"]',
      '[class*="push-notification"]',
      '[class*="notification-prompt"]'
    ]
  },

  // Get all active cosmetic rules based on settings
  async getActiveRules(settings) {
    const activeRules = [];

    if (!settings.masterEnabled) return activeRules;

    const categories = settings.categories || {};

    // Generic ad selectors (if ads enabled)
    if (categories.ads?.enabled) {
      activeRules.push(...this.rules.generic);
    }

    // Social widgets (if social enabled)
    if (categories.social?.enabled) {
      activeRules.push(...this.rules.social);
    }

    // Tracking pixels (if analytics enabled)
    if (categories.analytics?.enabled) {
      activeRules.push(...this.rules.tracking);
    }

    // Annoyances (if annoyances enabled)
    if (categories.annoyances?.enabled) {
      activeRules.push(...this.rules.annoyances);
    }

    // Custom cosmetic rules
    const customCosmetic = settings.customCosmeticRules || [];
    activeRules.push(...customCosmetic);

    // Site-specific rules
    const hostname = window.location?.hostname;
    if (hostname && settings.siteCosmeticRules?.[hostname]) {
      activeRules.push(...settings.siteCosmeticRules[hostname]);
    }

    return activeRules;
  },

  // Generate CSS string from rules
  generateCSS(rules) {
    if (rules.length === 0) return '';
    return rules.join(', ') + ' { display: none !important; }';
  },

  // Inject CSS into page
  async injectCSS(tabId, css) {
    if (!css) return;

    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        css: css
      });
    } catch (err) {
      console.error('[CosmeticFilter] Error injecting CSS:', err);
    }
  },

  // Remove injected CSS
  async removeCSS(tabId, css) {
    try {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css: css
      });
    } catch (err) {
      console.error('[CosmeticFilter] Error removing CSS:', err);
    }
  },

  // Apply cosmetic filters to a tab
  async applyToTab(tabId, settings) {
    // Check whitelist - skip cosmetic filtering for whitelisted domains
    const whitelist = settings.whitelist || [];
    if (whitelist.length > 0) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url) {
          const hostname = new URL(tab.url).hostname;
          if (whitelist.some(domain => hostname.includes(domain))) {
            // Whitelisted - skip cosmetic filtering
            return '';
          }
        }
      } catch (e) {
        // If we can't get tab info, continue normally
      }
    }

    const rules = await this.getActiveRules(settings);
    const css = this.generateCSS(rules);
    if (css) {
      await this.injectCSS(tabId, css);
    }
    return css;
  }
};

if (typeof module !== 'undefined') {
  module.exports = { CosmeticFilter };
}
