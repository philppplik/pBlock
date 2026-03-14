// pBlock - Filter Presets
// Manages EasyList, AdGuard, and other popular filter lists

const FilterPresets = {
  // Available presets
  presets: {
    easylist: {
      id: 'easylist',
      name: 'EasyList',
      description: 'Standard Ad-Blocking Liste (ca. 70.000 Regeln)',
      url: 'https://easylist.to/easylist/easylist.txt',
      enabled: false,
      ruleCount: 0,
      lastUpdate: null
    },
    easyprivacy: {
      id: 'easyprivacy',
      name: 'EasyPrivacy',
      description: 'Privacy & Tracking Schutz (ca. 30.000 Regeln)',
      url: 'https://easylist.to/easylist/easyprivacy.txt',
      enabled: false,
      ruleCount: 0,
      lastUpdate: null
    },
    adguard_base: {
      id: 'adguard_base',
      name: 'AdGuard Base',
      description: 'AdGuard Basisfilter (ca. 50.000 Regeln)',
      url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_2_Base/filter.txt',
      enabled: false,
      ruleCount: 0,
      lastUpdate: null
    },
    peter_lowe: {
      id: 'peter_lowe',
      name: 'Peter Lowe\'s List',
      description: 'Kompakte Tracker-Liste (ca. 3.000 Regeln)',
      url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
      enabled: false,
      ruleCount: 0,
      lastUpdate: null
    },
    urlhaus: {
      id: 'urlhaus',
      name: 'URLhaus Malware',
      description: 'Blockiert bekannte Malware-Domains',
      url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter.txt',
      enabled: false,
      ruleCount: 0,
      lastUpdate: null
    }
  },

  // Parse Adblock filter list to declarativeNetRequest rules
  parseFilterList(text, startId) {
    const rules = [];
    const lines = text.split('\n');
    let id = startId;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue;

      // Skip cosmetic rules (##) and exception rules (@@)
      if (trimmed.includes('##') || trimmed.includes('#@#')) continue;
      if (trimmed.startsWith('@@')) continue;

      // Convert Adblock syntax to urlFilter
      let urlFilter = trimmed;

      // Remove Adblock-specific syntax
      urlFilter = urlFilter.replace(/^\|\|/, '||');  // Domain anchor
      urlFilter = urlFilter.replace(/\^$/, '^');      // Separator anchor
      urlFilter = urlFilter.replace(/\*$/, '');       // Trailing wildcard

      // Skip rules that are too complex (regex, etc.)
      if (urlFilter.includes('/') && !urlFilter.startsWith('||')) continue;
      if (urlFilter.includes('$')) continue; // Options
      if (urlFilter.includes('~')) continue; // Negation

      // Skip if no valid pattern
      if (urlFilter.length < 4) continue;

      // Create rule
      rules.push({
        id: id++,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: urlFilter,
          resourceTypes: [
            'script', 'image', 'sub_frame', 'xmlhttprequest',
            'stylesheet', 'font', 'media', 'other'
          ]
        }
      });

      // Limit to prevent Chrome API overflow
      if (rules.length >= 10000) break;
    }

    return rules;
  },

  // Fetch and parse a preset
  async fetchPreset(presetId) {
    const preset = this.presets[presetId];
    if (!preset) throw new Error('Unknown preset: ' + presetId);

    try {
      const response = await fetch(preset.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      const startId = 20000 + (Object.keys(this.presets).indexOf(presetId) * 10000);
      const rules = this.parseFilterList(text, startId);

      return {
        rules,
        count: rules.length,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error(`[FilterPresets] Error fetching ${presetId}:`, err);
      throw err;
    }
  },

  // Get saved preset data
  async getPresetData(presetId) {
    return new Promise((resolve) => {
      chrome.storage.local.get(`preset_${presetId}`, (result) => {
        resolve(result[`preset_${presetId}`] || null);
      });
    });
  },

  // Save preset data
  async savePresetData(presetId, data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [`preset_${presetId}`]: data }, resolve);
    });
  },

  // Enable/disable a preset
  async togglePreset(presetId, enabled) {
    const preset = this.presets[presetId];
    if (!preset) return;

    preset.enabled = enabled;

    // Save setting
    const stored = await chrome.storage.sync.get('presets');
    const presets = stored.presets || {};
    presets[presetId] = { enabled };
    await chrome.storage.sync.set({ presets });

    return enabled;
  },

  // Update a preset (download latest)
  async updatePreset(presetId) {
    const result = await this.fetchPreset(presetId);
    await this.savePresetData(presetId, {
      rules: result.rules,
      count: result.count,
      timestamp: result.timestamp
    });

    this.presets[presetId].ruleCount = result.count;
    this.presets[presetId].lastUpdate = result.timestamp;

    return result;
  },

  // Get all preset statuses
  async getPresetStatuses() {
    const stored = await chrome.storage.sync.get('presets');
    const presets = stored.presets || {};

    const statuses = {};
    for (const [id, preset] of Object.entries(this.presets)) {
      const data = await this.getPresetData(id);
      statuses[id] = {
        ...preset,
        enabled: presets[id]?.enabled || false,
        ruleCount: data?.count || 0,
        lastUpdate: data?.timestamp || null
      };
    }
    return statuses;
  },

  // Get all active preset rules
  async getActivePresetRules() {
    const stored = await chrome.storage.sync.get('presets');
    const presets = stored.presets || {};

    const allRules = [];
    for (const [id, config] of Object.entries(presets)) {
      if (config.enabled) {
        const data = await this.getPresetData(id);
        if (data?.rules) {
          allRules.push(...data.rules);
        }
      }
    }
    return allRules;
  }
};

if (typeof module !== 'undefined') {
  module.exports = { FilterPresets };
}
