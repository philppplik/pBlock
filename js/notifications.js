// pBlock - Notification Manager

const NotificationManager = {
  // Show a notification
  async show(title, message, icon = '') {
    const settings = await this.getSettings();

    if (!settings.showNotifications) return;

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 0
    });
  },

  // Check if we should show milestone notification
  async checkMilestone(count) {
    const settings = await this.getSettings();

    if (!settings.showNotifications) return;

    const milestones = [100, 500, 1000, 5000, 10000, 50000, 100000];
    const lastMilestone = settings.lastMilestone || 0;

    for (const milestone of milestones) {
      if (count >= milestone && lastMilestone < milestone) {
        await this.show(
          'Meilenstein erreicht!',
          `Du hast ${this.formatNumber(count)} Anfragen blockiert!`
        );
        await this.saveSettings({ lastMilestone: milestone });
        break;
      }
    }
  },

  // Show daily summary
  async showDailySummary(today, total) {
    const settings = await this.getSettings();

    if (!settings.showNotifications || !settings.dailySummary) return;

    if (today > 0) {
      await this.show(
        'Tagesbericht',
        `Heute ${this.formatNumber(today)} blockiert. Gesamt: ${this.formatNumber(total)}`
      );
    }
  },

  // Get notification settings
  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('settings', (result) => {
        resolve(result.settings || {});
      });
    });
  },

  // Save notification settings
  async saveSettings(updates) {
    return new Promise((resolve) => {
      chrome.storage.sync.get('settings', (result) => {
        const settings = result.settings || {};
        Object.assign(settings, updates);
        chrome.storage.sync.set({ settings }, resolve);
      });
    });
  },

  // Format number for display
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + ' Mio.';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString('de-DE');
  }
};

if (typeof module !== 'undefined') {
  module.exports = { NotificationManager };
}
