// pBlock - Statistics Tracking v3.2.0
// Echtzeit-Stats mit Kategorie-Breakdown, Timeline und Bandbreite-Schätzung

// ==================== CONSTANTS ====================

// Rule-ID Ranges → Kategorie Mapping
const RULE_CATEGORY_MAP = {
  ads:        { min: 1,    max: 1000 },
  analytics:  { min: 1001, max: 2000 },
  social:     { min: 2001, max: 3000 },
  annoyances: { min: 3001, max: 4000 },
  oem:        { min: 4001, max: 5000 },
  custom:     { min: 10000, max: 19999 },
  presets:    { min: 20000, max: Infinity }
};

// Durchschnittliche Request-Größen für Bandbreite-Schätzung (Bytes)
const AVG_RESOURCE_SIZES = {
  script:         50 * 1024,   // 50 KB
  image:         100 * 1024,   // 100 KB
  stylesheet:     20 * 1024,   // 20 KB
  sub_frame:     200 * 1024,   // 200 KB (iframes)
  xmlhttprequest: 10 * 1024,   // 10 KB
  font:           80 * 1024,   // 80 KB
  media:         500 * 1024,   // 500 KB
  other:          10 * 1024    // 10 KB
};

// Kategorie Farben für UI
const CATEGORY_COLORS = {
  ads:        '#E54748',
  analytics:  '#58A6FF',
  social:     '#BC8CFF',
  annoyances: '#F0883E',
  oem:        '#8B949E',
  custom:     '#3FB950',
  presets:    '#79C0FF'
};

// ==================== STATISTICS MANAGER ====================

const StatisticsManager = {
  // Record a blocked request (erweitert v3.2.0)
  async recordBlock(domain, category = null, resourceType = 'other') {
    const data = await this.getLocalData();
    const today = new Date().toDateString();
    const weekNum = this.getWeekNumber();
    const currentHour = new Date().getHours();

    // Reset daily counter if new day
    if (data.todayDate !== today) {
      // Archive yesterday's hourly data
      data.dailyHistory[data.todayDate] = data.today;
      data.hourlyHistory[data.todayDate] = [...(data.hourlyHistory[today] || new Array(24).fill(0))];
      data.today = 0;
      data.todayDate = today;
      // Reset category daily counters
      for (const cat of Object.keys(data.categoryStats)) {
        data.categoryStats[cat].today = 0;
      }
      data.peakHour = -1;
      data.peakCount = 0;
    }

    // Reset weekly counter if new week
    if (data.weekNumber !== weekNum) {
      data.week = 0;
      data.weekNumber = weekNum;
    }

    // Increment counters
    data.today++;
    data.week++;
    data.total++;

    // Track top domains
    if (domain) {
      data.topDomains[domain] = (data.topDomains[domain] || 0) + 1;
    }

    // Track category stats
    if (category && data.categoryStats[category]) {
      data.categoryStats[category].total++;
      data.categoryStats[category].today++;
    }

    // Track hourly history (today)
    if (!data.hourlyHistory[today]) {
      data.hourlyHistory[today] = new Array(24).fill(0);
    }
    data.hourlyHistory[today][currentHour]++;

    // Peak hour tracking
    const todayHourly = data.hourlyHistory[today];
    const hourCount = todayHourly[currentHour];
    if (hourCount > data.peakCount) {
      data.peakHour = currentHour;
      data.peakCount = hourCount;
    }

    // Bandwidth estimation
    const estimatedSize = AVG_RESOURCE_SIZES[resourceType] || AVG_RESOURCE_SIZES.other;
    data.bandwidthSaved = (data.bandwidthSaved || 0) + estimatedSize;

    // Cleanup old data
    this.cleanupOldData(data);

    await this.setLocalData(data);
    await this.updateBadge(data.today);

    // Return updated stats for live updates
    return this.formatStats(data);
  },

  // Cleanup old hourly history (keep 30 days)
  cleanupOldData(data) {
    const historyKeys = Object.keys(data.dailyHistory).sort();
    if (historyKeys.length > 30) {
      const toDelete = historyKeys.slice(0, historyKeys.length - 30);
      for (const key of toDelete) {
        delete data.dailyHistory[key];
        delete data.hourlyHistory[key];
      }
    }

    // Keep only top 100 domains
    const domainEntries = Object.entries(data.topDomains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);
    data.topDomains = Object.fromEntries(domainEntries);
  },

  // Get category for a rule ID
  getCategoryForRule(ruleId) {
    for (const [category, range] of Object.entries(RULE_CATEGORY_MAP)) {
      if (ruleId >= range.min && ruleId <= range.max) {
        return category;
      }
    }
    return null;
  },

  // Get current statistics
  async getStatistics() {
    const data = await this.getLocalData();
    const today = new Date().toDateString();

    // Ensure counters are current
    if (data.todayDate !== today) {
      data.dailyHistory[data.todayDate] = data.today;
      data.hourlyHistory[data.todayDate] = data.hourlyHistory[today] || new Array(24).fill(0);
      data.today = 0;
      data.todayDate = today;
      for (const cat of Object.keys(data.categoryStats)) {
        data.categoryStats[cat].today = 0;
      }
      data.peakHour = -1;
      data.peakCount = 0;
      await this.setLocalData(data);
    }

    return this.formatStats(data);
  },

  // Format stats for output
  formatStats(data) {
    const today = new Date().toDateString();

    // Calculate category percentages
    const categoryBreakdown = {};
    let totalCatBlocks = 0;
    for (const [cat, stats] of Object.entries(data.categoryStats)) {
      totalCatBlocks += stats.total;
    }
    for (const [cat, stats] of Object.entries(data.categoryStats)) {
      categoryBreakdown[cat] = {
        ...stats,
        percentage: totalCatBlocks > 0 ? Math.round((stats.total / totalCatBlocks) * 100) : 0,
        color: CATEGORY_COLORS[cat] || '#8B949E'
      };
    }

    return {
      today: data.today,
      week: data.week,
      total: data.total,
      dailyHistory: data.dailyHistory,
      hourlyHistory: data.hourlyHistory,
      topDomains: data.topDomains,
      todayDate: data.todayDate,
      weekNumber: data.weekNumber,
      categoryStats: data.categoryStats,
      categoryBreakdown,
      bandwidthSaved: data.bandwidthSaved || 0,
      bandwidthFormatted: this.formatBytes(data.bandwidthSaved || 0),
      peakHour: data.peakHour,
      peakCount: data.peakCount,
      todayHourly: data.hourlyHistory[today] || new Array(24).fill(0)
    };
  },

  // Get last 7 days history as array
  async getWeeklyHistory() {
    const data = await this.getLocalData();
    const history = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toDateString();
      const dateKey = date.toISOString().split('T')[0];

      let count = 0;
      if (i === 0) {
        count = data.today;
      } else if (data.dailyHistory[dateStr]) {
        count = data.dailyHistory[dateStr];
      }

      history.push({
        date: dateKey,
        label: this.getDayLabel(date, i),
        count
      });
    }

    return history;
  },

  // Get hourly history for today
  async getTodayHourly() {
    const data = await this.getLocalData();
    const today = new Date().toDateString();
    return data.hourlyHistory[today] || new Array(24).fill(0);
  },

  // Get category breakdown
  async getCategoryBreakdown() {
    const data = await this.getLocalData();
    return this.formatStats(data).categoryBreakdown;
  },

  // Get top blocked domains
  async getTopDomains(limit = 10) {
    const data = await this.getLocalData();
    return Object.entries(data.topDomains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([domain, count]) => ({ domain, count }));
  },

  // Reset all statistics
  async reset() {
    await this.setLocalData(this.getDefaultData());
    await this.updateBadge(0);
  },

  // Update extension badge
  async updateBadge(count) {
    const stored = await chrome.storage.sync.get('settings');
    const showBadge = stored.settings?.showBadge !== false;

    if (showBadge && count > 0) {
      const text = count > 999 ? '999+' : count.toString();
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: '#E54748' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  },

  // Format bytes to human readable
  formatBytes(bytes) {
    if (bytes === 0) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  // Helper: Get day label for chart
  getDayLabel(date, daysAgo) {
    if (daysAgo === 0) return 'Heute';
    if (daysAgo === 1) return 'Gestern';
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    return days[date.getDay()];
  },

  // Helper: Get week number
  getWeekNumber() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now - start;
    return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
  },

  // Storage helpers (using local storage for stats - too large for sync)
  async getLocalData() {
    return new Promise((resolve) => {
      chrome.storage.local.get('statistics', (result) => {
        const data = result.statistics || this.getDefaultData();
        // Migration: ensure new fields exist
        if (!data.categoryStats) data.categoryStats = this.getDefaultData().categoryStats;
        if (!data.hourlyHistory) data.hourlyHistory = {};
        if (data.bandwidthSaved === undefined) data.bandwidthSaved = 0;
        if (data.peakHour === undefined) data.peakHour = -1;
        if (data.peakCount === undefined) data.peakCount = 0;
        resolve(data);
      });
    });
  },

  async setLocalData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ statistics: data }, resolve);
    });
  },

  getDefaultData() {
    return {
      today: 0,
      week: 0,
      total: 0,
      todayDate: new Date().toDateString(),
      weekNumber: this.getWeekNumber(),
      dailyHistory: {},
      hourlyHistory: {},
      topDomains: {},
      categoryStats: {
        ads:        { total: 0, today: 0 },
        analytics:  { total: 0, today: 0 },
        social:     { total: 0, today: 0 },
        annoyances: { total: 0, today: 0 },
        oem:        { total: 0, today: 0 },
        custom:     { total: 0, today: 0 },
        presets:    { total: 0, today: 0 }
      },
      bandwidthSaved: 0,
      peakHour: -1,
      peakCount: 0
    };
  }
};

// Extract domain from URL
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { StatisticsManager, extractDomain, RULE_CATEGORY_MAP, AVG_RESOURCE_SIZES, CATEGORY_COLORS };
}
