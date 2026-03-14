// pBlock - Rule Management with Categories

// All rules organized by category and subcategory
const RULE_REGISTRY = {
  ads: {
    google: [
      { id: 1, urlFilter: '||adtago.s3.amazonaws.com^' },
      { id: 2, urlFilter: '||analyticsengine.s3.amazonaws.com^' },
      { id: 3, urlFilter: '||analytics.s3.amazonaws.com^' },
      { id: 4, urlFilter: '||advice-ads.s3.amazonaws.com^' },
      { id: 5, urlFilter: '||pagead2.googlesyndication.com^' },
      { id: 6, urlFilter: '||adservice.google.com^' },
      { id: 7, urlFilter: '||pagead2.googleadservices.com^' },
      { id: 8, urlFilter: '||afs.googlesyndication.com^' },
      { id: 9, urlFilter: '||stats.g.doubleclick.net^' },
      { id: 10, urlFilter: '||ad.doubleclick.net^' },
      { id: 11, urlFilter: '||static.doubleclick.net^' },
      { id: 12, urlFilter: '||m.doubleclick.net^' },
      { id: 13, urlFilter: '||mediavisor.doubleclick.net^' },
      { id: 14, urlFilter: '||securepubads.g.doubleclick.net^' },
      { id: 15, urlFilter: '||tpc.googlesyndication.com^' },
      { id: 16, urlFilter: '||pagead2.googlesyndication.com^' }
    ],
    social_ads: [
      { id: 17, urlFilter: '||ads30.adcolony.com^' },
      { id: 18, urlFilter: '||adc3-launch.adcolony.com^' },
      { id: 19, urlFilter: '||events3alt.adcolony.com^' },
      { id: 20, urlFilter: '||wd.adcolony.com^' },
      { id: 21, urlFilter: '||static.media.net^' },
      { id: 22, urlFilter: '||media.net^' },
      { id: 23, urlFilter: '||adservetx.media.net^' },
      { id: 24, urlFilter: '||ads.youtube.com^' },
      { id: 25, urlFilter: '||ads.yahoo.com^' }
    ],
    display: [
      { id: 26, urlFilter: '||amazon-adsystem.com^' },
      { id: 27, urlFilter: '||adsrvr.org^' },
      { id: 28, urlFilter: '||adform.net^' },
      { id: 29, urlFilter: '||pubmatic.com^' },
      { id: 30, urlFilter: '||rubiconproject.com^' },
      { id: 31, urlFilter: '||casalemedia.com^' },
      { id: 32, urlFilter: '||sharethrough.com^' },
      { id: 33, urlFilter: '||bidswitch.net^' },
      { id: 34, urlFilter: '||yieldmo.com^' },
      { id: 35, urlFilter: '||openx.net^' },
      { id: 36, urlFilter: '||smartadserver.com^' },
      { id: 37, urlFilter: '||teads.tv^' },
      { id: 38, urlFilter: '||contextweb.com^' },
      { id: 39, urlFilter: '||33across.com^' },
      { id: 40, urlFilter: '||indexexchange.com^' },
      { id: 41, urlFilter: '||doubleverify.com^' },
      { id: 42, urlFilter: '||quantserve.com^' },
      { id: 43, urlFilter: '||scorecardresearch.com^' },
      { id: 44, urlFilter: '||chartbeat.com^' },
      { id: 45, urlFilter: '||zemanta.com^' },
      { id: 46, urlFilter: '||mathtag.com^' },
      { id: 47, urlFilter: '||turn.com^' },
      { id: 48, urlFilter: '||bluekai.com^' },
      { id: 49, urlFilter: '||demdex.net^' },
      { id: 50, urlFilter: '||omtrdc.net^' },
      { id: 51, urlFilter: '||everesttech.net^' },
      { id: 52, urlFilter: '||adroll.com^' },
      { id: 53, urlFilter: '||mediaplex.com^' },
      { id: 54, urlFilter: '||zedo.com^' },
      { id: 55, urlFilter: '||revjet.com^' },
      { id: 56, urlFilter: '||serving-sys.com^' },
      { id: 57, urlFilter: '||bat.bing.com^' }
    ],
    native: [
      { id: 58, urlFilter: '||outbrain.com^' },
      { id: 59, urlFilter: '||taboola.com^' },
      { id: 60, urlFilter: '||criteo.com^' },
      { id: 61, urlFilter: '||criteo.net^' },
      { id: 62, urlFilter: '||moatads.com^' }
    ]
  },

  analytics: {
    google_analytics: [
      { id: 1001, urlFilter: '||analytics.google.com^' },
      { id: 1002, urlFilter: '||click.googleanalytics.com^' },
      { id: 1003, urlFilter: '||google-analytics.com^' },
      { id: 1004, urlFilter: '||ssl.google-analytics.com^' },
      { id: 1005, urlFilter: '||googletagmanager.com^' },
      { id: 1006, urlFilter: '||clarity.ms^' },
      { id: 1007, urlFilter: '||optimizely.com^' }
    ],
    session_replay: [
      { id: 1008, urlFilter: '||adm.hotjar.com^' },
      { id: 1009, urlFilter: '||identify.hotjar.com^' },
      { id: 1010, urlFilter: '||insights.hotjar.com^' },
      { id: 1011, urlFilter: '||script.hotjar.com^' },
      { id: 1012, urlFilter: '||surveys.hotjar.com^' },
      { id: 1013, urlFilter: '||careers.hotjar.com^' },
      { id: 1014, urlFilter: '||events.hotjar.io^' },
      { id: 1015, urlFilter: '||mouseflow.com^' },
      { id: 1016, urlFilter: '||cdn.mouseflow.com^' },
      { id: 1017, urlFilter: '||o2.mouseflow.com^' },
      { id: 1018, urlFilter: '||gtm.mouseflow.com^' },
      { id: 1019, urlFilter: '||api.mouseflow.com^' },
      { id: 1020, urlFilter: '||tools.mouseflow.com^' },
      { id: 1021, urlFilter: '||cdn-test.mouseflow.com^' },
      { id: 1022, urlFilter: '||luckyorange.com^' },
      { id: 1023, urlFilter: '||api.luckyorange.com^' },
      { id: 1024, urlFilter: '||realtime.luckyorange.com^' },
      { id: 1025, urlFilter: '||cdn.luckyorange.com^' },
      { id: 1026, urlFilter: '||w1.luckyorange.com^' },
      { id: 1027, urlFilter: '||upload.luckyorange.net^' },
      { id: 1028, urlFilter: '||cs.luckyorange.net^' },
      { id: 1029, urlFilter: '||settings.luckyorange.net^' },
      { id: 1030, urlFilter: '||stats.wp.com^' }
    ],
    error_tracking: [
      { id: 1031, urlFilter: '||notify.bugsnag.com^' },
      { id: 1032, urlFilter: '||sessions.bugsnag.com^' },
      { id: 1033, urlFilter: '||api.bugsnag.com^' },
      { id: 1034, urlFilter: '||app.bugsnag.com^' },
      { id: 1035, urlFilter: '||browser.sentry-cdn.com^' },
      { id: 1036, urlFilter: '||app.getsentry.com^' }
    ],
    marketing: [
      { id: 1037, urlFilter: '||freshmarketer.com^' },
      { id: 1038, urlFilter: '||claritybt.freshmarketer.com^' },
      { id: 1039, urlFilter: '||fwtracks.freshmarketer.com^' }
    ]
  },

  social: {
    facebook: [
      { id: 2001, urlFilter: '||pixel.facebook.com^' },
      { id: 2002, urlFilter: '||an.facebook.com^' },
      { id: 2003, urlFilter: '||connect.facebook.net^' },
      { id: 2004, urlFilter: '||facebook.com/tr^' }
    ],
    twitter: [
      { id: 2005, urlFilter: '||static.ads-twitter.com^' },
      { id: 2006, urlFilter: '||ads-api.twitter.com^' },
      { id: 2007, urlFilter: '||twitter.com/i/jot^' },
      { id: 2008, urlFilter: '||t.co^' }
    ],
    linkedin: [
      { id: 2009, urlFilter: '||ads.linkedin.com^' },
      { id: 2010, urlFilter: '||analytics.pointdrive.linkedin.com^' },
      { id: 2011, urlFilter: '||snap.licdn.com^' }
    ],
    pinterest: [
      { id: 2012, urlFilter: '||ads.pinterest.com^' },
      { id: 2013, urlFilter: '||log.pinterest.com^' },
      { id: 2014, urlFilter: '||analytics.pinterest.com^' },
      { id: 2015, urlFilter: '||trk.pinterest.com^' }
    ],
    tiktok: [
      { id: 2016, urlFilter: '||ads-api.tiktok.com^' },
      { id: 2017, urlFilter: '||analytics.tiktok.com^' },
      { id: 2018, urlFilter: '||ads-sg.tiktok.com^' },
      { id: 2019, urlFilter: '||analytics-sg.tiktok.com^' },
      { id: 2020, urlFilter: '||business-api.tiktok.com^' },
      { id: 2021, urlFilter: '||ads.tiktok.com^' },
      { id: 2022, urlFilter: '||log.byteoversea.com^' }
    ],
    reddit: [
      { id: 2023, urlFilter: '||events.reddit.com^' },
      { id: 2024, urlFilter: '||events.redditmedia.com^' }
    ]
  },

  annoyances: {
    content_rec: [
      { id: 3001, urlFilter: '||outbrain.com^' },
      { id: 3002, urlFilter: '||taboola.com^' }
    ],
    ad_measurement: [
      { id: 3003, urlFilter: '||moatads.com^' },
      { id: 3004, urlFilter: '||doubleverify.com^' }
    ]
  },

  oem: {
    samsung: [
      { id: 4001, urlFilter: '||samsungads.com^' },
      { id: 4002, urlFilter: '||smetrics.samsung.com^' },
      { id: 4003, urlFilter: '||nmetrics.samsung.com^' },
      { id: 4004, urlFilter: '||samsung-com.112.2o7.net^' },
      { id: 4005, urlFilter: '||analytics-api.samsunghealthcn.com^' }
    ],
    xiaomi: [
      { id: 4006, urlFilter: '||api.ad.xiaomi.com^' },
      { id: 4007, urlFilter: '||data.mistat.xiaomi.com^' },
      { id: 4008, urlFilter: '||data.mistat.india.xiaomi.com^' },
      { id: 4009, urlFilter: '||data.mistat.rus.xiaomi.com^' },
      { id: 4010, urlFilter: '||sdkconfig.ad.xiaomi.com^' },
      { id: 4011, urlFilter: '||sdkconfig.ad.intl.xiaomi.com^' },
      { id: 4012, urlFilter: '||tracking.rus.miui.com^' }
    ],
    huawei: [
      { id: 4013, urlFilter: '||metrics.data.hicloud.com^' },
      { id: 4014, urlFilter: '||metrics2.data.hicloud.com^' },
      { id: 4015, urlFilter: '||grs.hicloud.com^' },
      { id: 4016, urlFilter: '||logservice.hicloud.com^' },
      { id: 4017, urlFilter: '||logservice1.hicloud.com^' },
      { id: 4018, urlFilter: '||logbak.hicloud.com^' }
    ],
    oppo: [
      { id: 4019, urlFilter: '||adsfs.oppomobile.com^' },
      { id: 4020, urlFilter: '||adx.ads.oppomobile.com^' },
      { id: 4021, urlFilter: '||ck.ads.oppomobile.com^' },
      { id: 4022, urlFilter: '||data.ads.oppomobile.com^' },
      { id: 4023, urlFilter: '||iot-eu-logser.realme.com^' },
      { id: 4024, urlFilter: '||iot-logser.realme.com^' },
      { id: 4025, urlFilter: '||bdapi-ads.realmemobile.com^' },
      { id: 4026, urlFilter: '||bdapi-in-ads.realmemobile.com^' }
    ],
    apple: [
      { id: 4027, urlFilter: '||iadsdk.apple.com^' },
      { id: 4028, urlFilter: '||metrics.icloud.com^' },
      { id: 4029, urlFilter: '||metrics.mzstatic.com^' },
      { id: 4030, urlFilter: '||api-adservices.apple.com^' },
      { id: 4031, urlFilter: '||books-analytics-events.apple.com^' },
      { id: 4032, urlFilter: '||weather-analytics-events.apple.com^' },
      { id: 4033, urlFilter: '||notes-analytics-events.apple.com^' }
    ],
    oneplus: [
      { id: 4034, urlFilter: '||click.oneplus.cn^' },
      { id: 4035, urlFilter: '||open.oneplus.net^' }
    ],
    yahoo: [
      { id: 4036, urlFilter: '||analytics.yahoo.com^' },
      { id: 4037, urlFilter: '||geo.yahoo.com^' },
      { id: 4038, urlFilter: '||udc.yahoo.com^' },
      { id: 4039, urlFilter: '||udcm.yahoo.com^' },
      { id: 4040, urlFilter: '||analytics.query.yahoo.com^' },
      { id: 4041, urlFilter: '||partnerads.ysm.yahoo.com^' },
      { id: 4042, urlFilter: '||log.fc.yahoo.com^' },
      { id: 4043, urlFilter: '||gemini.yahoo.com^' },
      { id: 4044, urlFilter: '||adtech.yahooinc.com^' }
    ],
    yandex: [
      { id: 4045, urlFilter: '||extmaps-api.yandex.net^' },
      { id: 4046, urlFilter: '||appmetrica.yandex.ru^' },
      { id: 4047, urlFilter: '||adfstat.yandex.ru^' },
      { id: 4048, urlFilter: '||metrika.yandex.ru^' },
      { id: 4049, urlFilter: '||offerwall.yandex.net^' },
      { id: 4050, urlFilter: '||adfox.yandex.ru^' }
    ],
    unity: [
      { id: 4051, urlFilter: '||auction.unityads.unity3d.com^' },
      { id: 4052, urlFilter: '||webview.unityads.unity3d.com^' },
      { id: 4053, urlFilter: '||config.unityads.unity3d.com^' },
      { id: 4054, urlFilter: '||adserver.unityads.unity3d.com^' }
    ]
  }
};

const RESOURCE_TYPES = [
  'script', 'image', 'sub_frame', 'xmlhttprequest',
  'stylesheet', 'font', 'media', 'other'
];

// Rule Manager - generates dynamic rules based on settings
const RuleManager = {
  // Get all rules that should be active based on settings
  async getActiveRules(settings) {
    const rules = [];
    const whitelist = settings.whitelist || [];
    const customRules = settings.customRules || [];

    // Category rules
    for (const [catKey, catConfig] of Object.entries(settings.categories)) {
      if (!catConfig.enabled) continue;

      const catRules = RULE_REGISTRY[catKey];
      if (!catRules) continue;

      for (const [subKey, subRules] of Object.entries(catRules)) {
        // Check subcategory setting
        const subConfig = catConfig.subcategories?.[subKey];
        if (subConfig && !subConfig.enabled) continue;

        for (const rule of subRules) {
          // Build condition with whitelist exclusion
          const condition = {
            urlFilter: rule.urlFilter,
            resourceTypes: RESOURCE_TYPES
          };

          // Exclude whitelisted domains - NOTHING gets blocked on these sites
          if (whitelist.length > 0) {
            condition.excludedInitiatorDomains = whitelist;
          }

          rules.push({
            id: rule.id,
            priority: 1,
            action: { type: 'block' },
            condition
          });
        }
      }
    }

    // Custom rules (IDs start at 10000)
    customRules.forEach((rule, index) => {
      const condition = {
        urlFilter: rule.urlFilter,
        resourceTypes: RESOURCE_TYPES
      };

      if (whitelist.length > 0) {
        condition.excludedInitiatorDomains = whitelist;
      }

      rules.push({
        id: 10000 + index,
        priority: 1,
        action: { type: 'block' },
        condition
      });
    });

    return rules;
  },

  // Get all available rule IDs for a category
  getRuleIdsForCategory(categoryId) {
    const catRules = RULE_REGISTRY[categoryId];
    if (!catRules) return [];

    const ids = [];
    for (const subRules of Object.values(catRules)) {
      for (const rule of subRules) {
        ids.push(rule.id);
      }
    }
    return ids;
  },

  // Get count of rules per category
  getCategoryStats() {
    const stats = {};
    for (const [catKey, catRules] of Object.entries(RULE_REGISTRY)) {
      let total = 0;
      const subcategories = {};
      for (const [subKey, subRules] of Object.entries(catRules)) {
        subcategories[subKey] = subRules.length;
        total += subRules.length;
      }
      stats[catKey] = { total, subcategories };
    }
    return stats;
  },

  // Count total rules from all enabled categories
  async countEnabledRules(settings) {
    const rules = await this.getActiveRules(settings);
    return rules.length;
  },

  // Update dynamic rules in Chrome
  async updateDynamicRules(rules) {
    // Get existing rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map(r => r.id);

    // Calculate new IDs
    const newIds = rules.map(r => r.id);

    // Remove ALL existing rules first, then add new ones
    // This avoids "rule ID already exists" errors
    if (existingIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds,
        addRules: []
      });
    }

    // Now add the new rules
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [],
      addRules: rules
    });

    console.log(`[RuleManager] Updated: ${rules.length} active, ${existingIds.length} removed`);
    return rules.length;
  }
};

if (typeof module !== 'undefined') {
  module.exports = { RULE_REGISTRY, RuleManager, RESOURCE_TYPES };
}
