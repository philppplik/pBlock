// pBlock - Background Service Worker (v3.0)
importScripts(
  'js/storage.js',
  'js/rules.js',
  'js/statistics.js',
  'js/cosmetic-filter.js',
  'js/presets.js',
  'js/site-stats.js',
  'js/notifications.js'
);

// ==================== INSTALL & STARTUP ====================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[AdBlocker] Installed, reason:', details.reason);

  // Initialize storage with defaults
  const stored = await StorageManager.get(null);
  if (stored.masterEnabled === undefined) {
    await StorageManager.set(STORAGE_DEFAULTS);
    console.log('[AdBlocker] Initialized with defaults');
  }

  // Show wizard on first install
  if (details.reason === 'install') {
    const wizardDone = await chrome.storage.local.get('wizardCompleted');
    if (!wizardDone.wizardCompleted) {
      chrome.tabs.create({ url: chrome.runtime.getURL('wizard.html') });
    }
  }

  // Create context menu
  createContextMenus();

  // Apply initial rules
  await applyRules();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[AdBlocker] Service worker started');
  await applyRules();
  const stats = await StatisticsManager.getStatistics();
  await StatisticsManager.updateBadge(stats.today);
});

// ==================== CONTEXT MENUS ====================

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'adblocker-block-element',
      title: 'Element blockieren',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'adblocker-separator',
      type: 'separator',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'adblocker-whitelist-site',
      title: 'Diese Seite whitelisten',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      id: 'adblocker-open-options',
      title: 'Einstellungen öffnen',
      contexts: ['all']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'adblocker-block-element':
      // Activate element picker on the page
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'activatePicker' });
      }
      break;

    case 'adblocker-whitelist-site':
      if (tab?.url) {
        try {
          const url = new URL(tab.url);
          await StorageManager.addToWhitelist(url.hostname);
          await applyRules();
          await NotificationManager.show(
            'Whitelist',
            `${url.hostname} wurde zur Whitelist hinzugefügt`
          );
        } catch (e) {
          console.error('Invalid URL');
        }
      }
      break;

    case 'adblocker-open-options':
      chrome.runtime.openOptionsPage();
      break;
  }
});

// ==================== STATISTICS TRACKING ====================

// Port connections for live stats updates
const statsPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'stats') {
    statsPorts.add(port);
    port.onDisconnect.addListener(() => {
      statsPorts.delete(port);
    });
  }
});

// Broadcast stats update to all connected popup instances
function broadcastStatsUpdate(stats) {
  for (const port of statsPorts) {
    try {
      port.postMessage({ type: 'statsUpdate', stats });
    } catch (e) {
      statsPorts.delete(port);
    }
  }
}

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (details) => {
  const domain = extractDomain(details.request.url);
  const hostname = extractDomain(details.request.initiator || details.request.url);
  const ruleId = details.rule?.ruleId;
  const resourceType = details.request?.resourceType || 'other';

  // Determine category from rule ID
  const category = StatisticsManager.getCategoryForRule(ruleId);

  // Record block with category and resource type
  const stats = await StatisticsManager.recordBlock(domain, category, resourceType);

  // Per-site stats (with category)
  if (hostname) {
    await SiteStatsManager.recordSiteBlock(hostname, category);
  }

  // Broadcast to connected popup instances
  broadcastStatsUpdate(stats);

  // Check milestones (throttled - only every 100 blocks)
  if (stats.total % 100 === 0) {
    await NotificationManager.checkMilestone(stats.total);
  }
});

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    // === Core State ===
    case 'getState': {
      const settings = await StorageManager.getAll();
      const stats = await StatisticsManager.getStatistics();
      sendResponse({
        masterEnabled: settings.masterEnabled,
        filterLevel: settings.filterLevel,
        categories: settings.categories,
        statistics: stats
      });
      break;
    }

    case 'getFullState': {
      const settings = await StorageManager.getAll();
      const stats = await StatisticsManager.getStatistics();
      const ruleStats = RuleManager.getCategoryStats();
      const activeRuleCount = await RuleManager.countEnabledRules(settings);
      sendResponse({
        settings,
        statistics: stats,
        ruleStats,
        activeRuleCount
      });
      break;
    }

    // === Master Toggle ===
    case 'toggle': {
      await StorageManager.set({ masterEnabled: message.enabled });
      await applyRules();
      sendResponse({ masterEnabled: message.enabled });
      break;
    }

    // === Category Toggles ===
    case 'toggleCategory': {
      await StorageManager.saveCategory(message.categoryId, message.enabled);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    case 'toggleSubcategory': {
      await StorageManager.saveSubcategory(
        message.categoryId,
        message.subcategoryId,
        message.enabled
      );
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    // === Filter Level ===
    case 'setFilterLevel': {
      await StorageManager.saveFilterLevel(message.level);
      sendResponse({ filterLevel: message.level });
      break;
    }

    case 'applySliderPreset': {
      await StorageManager.applySliderPreset(message.value);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    // === Statistics ===
    case 'getStatistics': {
      const stats = await StatisticsManager.getStatistics();
      sendResponse(stats);
      break;
    }

    case 'getWeeklyHistory': {
      const history = await StatisticsManager.getWeeklyHistory();
      sendResponse(history);
      break;
    }

    case 'getTopDomains': {
      const top = await StatisticsManager.getTopDomains(message.limit || 10);
      sendResponse(top);
      break;
    }

    case 'getTodayHourly': {
      const hourly = await StatisticsManager.getTodayHourly();
      sendResponse(hourly);
      break;
    }

    case 'getCategoryBreakdown': {
      const breakdown = await StatisticsManager.getCategoryBreakdown();
      sendResponse(breakdown);
      break;
    }

    case 'resetStatistics': {
      await StatisticsManager.reset();
      await SiteStatsManager.resetAllStats();
      sendResponse({ success: true });
      break;
    }

    // === Site Stats ===
    case 'getSiteStats': {
      const siteStats = await SiteStatsManager.getAllStats();
      sendResponse(siteStats);
      break;
    }

    case 'getCurrentSiteStats': {
      const current = await SiteStatsManager.getCurrentSiteStats();
      sendResponse(current);
      break;
    }

    case 'getTopSites': {
      const top = await SiteStatsManager.getTopSites(message.limit || 10);
      sendResponse(top);
      break;
    }

    // === Whitelist ===
    case 'addToWhitelist': {
      await StorageManager.addToWhitelist(message.domain);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    case 'removeFromWhitelist': {
      await StorageManager.removeFromWhitelist(message.domain);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    // === Custom Rules ===
    case 'addCustomRule': {
      await StorageManager.addCustomRule(message.rule);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    case 'removeCustomRule': {
      await StorageManager.removeCustomRule(message.index);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    // === Element Picker ===
    case 'addElementRule': {
      const selector = message.selector;
      const domain = message.domain;
      const rule = {
        urlFilter: selector,
        domain: domain,
        type: 'cosmetic',
        created: Date.now()
      };
      await StorageManager.addCustomRule(rule);

      // Also save as cosmetic rule
      const settings = await StorageManager.get('customCosmeticRules');
      const cosmeticRules = settings.customCosmeticRules || [];
      cosmeticRules.push(selector);
      await StorageManager.set({ customCosmeticRules: cosmeticRules });

      sendResponse({ success: true });
      break;
    }

    case 'activatePicker': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'activatePicker' });
      }
      sendResponse({ success: true });
      break;
    }

    // === Presets ===
    case 'getPresets': {
      const statuses = await FilterPresets.getPresetStatuses();
      sendResponse(statuses);
      break;
    }

    case 'togglePreset': {
      await FilterPresets.togglePreset(message.presetId, message.enabled);
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    case 'updatePreset': {
      try {
        const result = await FilterPresets.updatePreset(message.presetId);
        await applyRules();
        sendResponse({ success: true, count: result.count });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    // === Backup ===
    case 'exportSettings': {
      const exported = await StorageManager.exportSettings();
      sendResponse({ data: exported });
      break;
    }

    case 'importSettings': {
      const success = await StorageManager.importSettings(message.data);
      if (success) await applyRules();
      sendResponse({ success });
      break;
    }

    case 'resetSettings': {
      await StorageManager.resetToDefaults();
      await applyRules();
      sendResponse({ success: true });
      break;
    }

    // === Apply Rules ===
    case 'applyRules': {
      const count = await applyRules();
      sendResponse({ ruleCount: count });
      break;
    }

    case 'getRuleStats': {
      const stats = RuleManager.getCategoryStats();
      sendResponse(stats);
      break;
    }

    // === Notifications ===
    case 'updateNotificationSettings': {
      await NotificationManager.saveSettings(message.settings);
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ error: 'Unknown message type' });
  }
}

// ==================== RULE APPLICATION ====================

async function applyRules() {
  try {
    const settings = await StorageManager.getAll();

    if (!settings.masterEnabled) {
      await clearAllDynamicRules();
      await StatisticsManager.updateBadge(0);
      return 0;
    }

    // Get base rules from categories
    const baseRules = await RuleManager.getActiveRules(settings);

    // Get preset rules
    const presetRules = await FilterPresets.getActivePresetRules();

    // Combine all rules
    const allRules = [...baseRules, ...presetRules];

    // Apply to Chrome
    const count = await RuleManager.updateDynamicRules(allRules);

    // Apply cosmetic filters to all tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        try {
          await CosmeticFilter.applyToTab(tab.id, settings);
          // Also notify content script with updated settings
          await chrome.tabs.sendMessage(tab.id, {
            type: 'updateSettings',
            settings: {
              masterEnabled: settings.masterEnabled,
              categories: settings.categories
            }
          }).catch(() => {});
        } catch (e) {
          // Ignore errors for restricted tabs
        }
      }
    }

    // Update badge
    const stats = await StatisticsManager.getStatistics();
    await StatisticsManager.updateBadge(stats.today);

    console.log(`[AdBlocker] Applied ${count} rules (${baseRules.length} base + ${presetRules.length} preset)`);
    return count;
  } catch (err) {
    console.error('[AdBlocker] Error applying rules:', err);
    return 0;
  }
}

async function clearAllDynamicRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = existing.map(r => r.id);
  if (ids.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ids,
      addRules: []
    });
  }
}

// ==================== HELPER ====================

function extractDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
