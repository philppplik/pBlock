// pBlock - Per-Site Statistics

const SiteStatsManager = {
  // Record a blocked request for a specific site
  async recordSiteBlock(hostname, category) {
    if (!hostname) return;

    const data = await this.getData();
    const today = new Date().toISOString().split('T')[0];

    if (!data[hostname]) {
      data[hostname] = {
        total: 0,
        today: 0,
        todayDate: today,
        categories: {}
      };
    }

    const site = data[hostname];

    // Reset daily counter if new day
    if (site.todayDate !== today) {
      site.today = 0;
      site.todayDate = today;
    }

    // Increment counters
    site.total++;
    site.today++;

    // Category counter
    if (category) {
      site.categories[category] = (site.categories[category] || 0) + 1;
    }

    await this.setData(data);
  },

  // Get stats for a specific site
  async getSiteStats(hostname) {
    const data = await this.getData();
    return data[hostname] || null;
  },

  // Get all site stats
  async getAllStats() {
    return await this.getData();
  },

  // Get top sites by block count
  async getTopSites(limit = 10) {
    const data = await this.getData();
    return Object.entries(data)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit)
      .map(([hostname, stats]) => ({
        hostname,
        total: stats.total,
        today: stats.today,
        categories: stats.categories
      }));
  },

  // Get current site stats (from active tab)
  async getCurrentSiteStats() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]?.url) {
          try {
            const url = new URL(tabs[0].url);
            const stats = await this.getSiteStats(url.hostname);
            resolve({ hostname: url.hostname, stats });
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  },

  // Reset stats for a specific site
  async resetSiteStats(hostname) {
    const data = await this.getData();
    delete data[hostname];
    await this.setData(data);
  },

  // Reset all site stats
  async resetAllStats() {
    await this.setData({});
  },

  // Storage helpers
  async getData() {
    return new Promise((resolve) => {
      chrome.storage.local.get('siteStats', (result) => {
        resolve(result.siteStats || {});
      });
    });
  },

  async setData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ siteStats: data }, resolve);
    });
  }
};

if (typeof module !== 'undefined') {
  module.exports = { SiteStatsManager };
}
