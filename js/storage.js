// pBlock - Storage Schema & Helpers

const STORAGE_DEFAULTS = {
  // Master switch
  masterEnabled: true,

  // Filter level: 'simple' | 'expert'
  filterLevel: 'simple',

  // Simple mode slider value (0, 25, 50, 75, 100)
  sliderValue: 50,

  // Category settings
  categories: {
    ads: {
      enabled: true,
      label: 'Werbung',
      icon: 'mdi:shield-check',
      description: 'Blockiert Online-Werbung und Banner',
      subcategories: {
        google: { enabled: true, label: 'Google Ads', description: 'Google Werbung & Doubleclick' },
        social_ads: { enabled: true, label: 'Social Ads', description: 'Werbung auf Social Media' },
        display: { enabled: true, label: 'Display Ads', description: 'Banner, Popups, Video Ads' },
        native: { enabled: true, label: 'Native Ads', description: 'Versteckte Werbung (Taboola, Outbrain)' }
      }
    },
    analytics: {
      enabled: true,
      label: 'Tracker',
      icon: 'mdi:chart-bar',
      description: 'Blockiert Tracking und Analytics',
      subcategories: {
        google_analytics: { enabled: true, label: 'Google Analytics', description: 'Google Tracking' },
        session_replay: { enabled: true, label: 'Session Replay', description: 'Hotjar, Mouseflow, Lucky Orange' },
        error_tracking: { enabled: false, label: 'Error Tracking', description: 'Bugsnag, Sentry (kann Seiten brechen)' },
        marketing: { enabled: true, label: 'Marketing', description: 'Freshmarketer, Clarity' }
      }
    },
    social: {
      enabled: true,
      label: 'Social Media',
      icon: 'mdi:cellphone',
      description: 'Blockiert Social Media Tracking',
      subcategories: {
        facebook: { enabled: true, label: 'Facebook/Meta', description: 'Facebook Pixel & Tracker' },
        twitter: { enabled: true, label: 'Twitter/X', description: 'Twitter Ads & Tracking' },
        linkedin: { enabled: true, label: 'LinkedIn', description: 'LinkedIn Analytics' },
        pinterest: { enabled: true, label: 'Pinterest', description: 'Pinterest Ads & Tracking' },
        tiktok: { enabled: true, label: 'TikTok', description: 'TikTok Ads & Analytics' },
        reddit: { enabled: true, label: 'Reddit', description: 'Reddit Events & Tracking' }
      }
    },
    annoyances: {
      enabled: true,
      label: 'Nerviges',
      icon: 'mdi:bell-off-outline',
      description: 'Blockiert nervige Webseiten-Elemente',
      subcategories: {
        content_rec: { enabled: true, label: 'Content Empfehlungen', description: 'Taboola, Outbrain Widgets' },
        ad_measurement: { enabled: true, label: 'Ad Messung', description: 'Moat, DoubleVerify' }
      }
    },
    oem: {
      enabled: false,
      label: 'Hersteller',
      icon: 'mdi:cellphone',
      description: 'OEM/Hersteller Tracking (Samsung, Xiaomi, etc.)',
      subcategories: {
        samsung: { enabled: true, label: 'Samsung', description: 'Samsung Ads & Analytics' },
        xiaomi: { enabled: true, label: 'Xiaomi', description: 'Xiaomi Tracking & Ads' },
        huawei: { enabled: true, label: 'Huawei', description: 'Huawei Analytics' },
        oppo: { enabled: true, label: 'Oppo/Realme', description: 'Oppo & Realme Tracking' },
        apple: { enabled: true, label: 'Apple', description: 'Apple Ad Services' },
        oneplus: { enabled: true, label: 'OnePlus', description: 'OnePlus Tracking' },
        yahoo: { enabled: true, label: 'Yahoo', description: 'Yahoo Ads & Analytics' },
        yandex: { enabled: true, label: 'Yandex', description: 'Yandex Metrica & Ads' },
        unity: { enabled: true, label: 'Unity Ads', description: 'Unity Werbung' }
      }
    }
  },

  // Whitelist - domains that should never be blocked
  whitelist: [],

  // Custom user rules
  customRules: [],

  // Element blocking rules (from right-click picker)
  elementRules: [],

  // Statistics
  statistics: {
    today: 0,
    week: 0,
    total: 0,
    todayDate: new Date().toDateString(),
    weekNumber: getWeekNumber(),
    dailyHistory: {},  // { '2024-01-15': 123, ... }
    topDomains: {}     // { 'doubleclick.net': 456, ... }
  },

  // Settings
  settings: {
    showBadge: true,
    showNotifications: false,
    notificationThreshold: 100,
    autoUpdatePresets: true
  }
};

function getWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
}

// Storage helper functions
const StorageManager = {
  async get(keys = null) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, (result) => {
        resolve(result);
      });
    });
  },

  async set(data) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, () => {
        resolve();
      });
    });
  },

  async getAll() {
    const stored = await this.get(null);
    return this.mergeWithDefaults(stored);
  },

  mergeWithDefaults(stored) {
    const merged = JSON.parse(JSON.stringify(STORAGE_DEFAULTS));

    if (stored.masterEnabled !== undefined) merged.masterEnabled = stored.masterEnabled;
    if (stored.filterLevel) merged.filterLevel = stored.filterLevel;
    if (stored.sliderValue !== undefined) merged.sliderValue = stored.sliderValue;
    if (stored.whitelist) merged.whitelist = stored.whitelist;
    if (stored.customRules) merged.customRules = stored.customRules;
    if (stored.elementRules) merged.elementRules = stored.elementRules;

    if (stored.categories) {
      for (const [catKey, catValue] of Object.entries(stored.categories)) {
        if (merged.categories[catKey]) {
          merged.categories[catKey].enabled = catValue.enabled;
          if (catValue.subcategories) {
            for (const [subKey, subValue] of Object.entries(catValue.subcategories)) {
              if (merged.categories[catKey].subcategories[subKey]) {
                merged.categories[catKey].subcategories[subKey].enabled = subValue.enabled;
              }
            }
          }
        }
      }
    }

    if (stored.settings) {
      Object.assign(merged.settings, stored.settings);
    }

    return merged;
  },

  async saveCategory(categoryId, enabled) {
    const stored = await this.get('categories');
    const categories = stored.categories || {};
    if (!categories[categoryId]) categories[categoryId] = {};
    categories[categoryId].enabled = enabled;
    await this.set({ categories });
  },

  async saveSubcategory(categoryId, subcategoryId, enabled) {
    const stored = await this.get('categories');
    const categories = stored.categories || {};
    if (!categories[categoryId]) categories[categoryId] = { subcategories: {} };
    if (!categories[categoryId].subcategories) categories[categoryId].subcategories = {};
    categories[categoryId].subcategories[subcategoryId] = { enabled };
    await this.set({ categories });
  },

  async saveFilterLevel(level) {
    await this.set({ filterLevel: level });
  },

  async saveSliderValue(value) {
    await this.set({ sliderValue: value });
  },

  async applySliderPreset(value) {
    const SLIDER_PRESETS = {
      0:   { ads: false, analytics: false, social: false, annoyances: false, oem: false },
      25:  { ads: true,  analytics: false, social: false, annoyances: false, oem: false },
      50:  { ads: true,  analytics: true,  social: false, annoyances: false, oem: false },
      75:  { ads: true,  analytics: true,  social: true,  annoyances: true,  oem: false },
      100: { ads: true,  analytics: true,  social: true,  annoyances: true,  oem: true }
    };
    const preset = SLIDER_PRESETS[value] || SLIDER_PRESETS[50];
    const categories = {};
    for (const [catKey, enabled] of Object.entries(preset)) {
      categories[catKey] = { enabled };
    }
    await this.set({ sliderValue: value, categories });
  },

  async addToWhitelist(domain) {
    const stored = await this.get('whitelist');
    const whitelist = stored.whitelist || [];
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      await this.set({ whitelist });
    }
  },

  async removeFromWhitelist(domain) {
    const stored = await this.get('whitelist');
    const whitelist = (stored.whitelist || []).filter(d => d !== domain);
    await this.set({ whitelist });
  },

  async addCustomRule(rule) {
    const stored = await this.get('customRules');
    const customRules = stored.customRules || [];
    customRules.push(rule);
    await this.set({ customRules });
  },

  async removeCustomRule(index) {
    const stored = await this.get('customRules');
    const customRules = (stored.customRules || []).filter((_, i) => i !== index);
    await this.set({ customRules });
  },

  // === Element Blocking Rules ===

  async addElementRule(rule) {
    const stored = await this.get('elementRules');
    const elementRules = stored.elementRules || [];
    elementRules.push({
      selector: rule.selector,
      domain: rule.siteOnly ? rule.domain : null,
      siteOnly: rule.siteOnly || false,
      created: Date.now()
    });
    await this.set({ elementRules });
    return elementRules;
  },

  async removeElementRule(index) {
    const stored = await this.get('elementRules');
    const elementRules = (stored.elementRules || []).filter((_, i) => i !== index);
    await this.set({ elementRules });
    return elementRules;
  },

  async getElementRules(domain = null) {
    const stored = await this.get('elementRules');
    const elementRules = stored.elementRules || [];
    if (domain) {
      return elementRules.filter(r => !r.siteOnly || r.domain === domain);
    }
    return elementRules;
  },

  async clearAllElementRules() {
    await this.set({ elementRules: [] });
  },

  async undoLastElementBlock() {
    const stored = await this.get('elementRules');
    const elementRules = stored.elementRules || [];
    if (elementRules.length === 0) return null;
    const removed = elementRules.pop();
    await this.set({ elementRules });
    return removed;
  },

  async exportSettings() {
    const all = await this.get(null);
    return JSON.stringify(all, null, 2);
  },

  async importSettings(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      await this.set(data);
      return true;
    } catch (e) {
      console.error('Import error:', e);
      return false;
    }
  },

  async resetToDefaults() {
    await chrome.storage.sync.clear();
    await this.set(STORAGE_DEFAULTS);
  }
};

// Export for use in other modules
if (typeof module !== 'undefined') {
  module.exports = { STORAGE_DEFAULTS, StorageManager };
}
