/**
 * Mitgelieferte Filterdaten, gruppiert nach Kategorie und Unterkategorie.
 *
 * ## Warum Domains statt fertiger Regeln
 *
 * v4 legte pro Domain ein komplettes declarativeNetRequest-Regelobjekt mit fester
 * ID an — rund 200 Regeln für gut 200 Domains. Das ist verschwenderisch:
 * `declarativeNetRequest` kennt die Bedingung `requestDomains`, die eine Liste von
 * Domains inklusive aller Subdomains in **einer** Regel abbildet. Aus ~200 Regeln
 * werden so gut zwei Dutzend. Das spart Kontingent, beschleunigt jeden
 * `updateDynamicRules`-Aufruf und macht Regel-IDs zur reinen Buchhaltung.
 *
 * ## Konventionen
 *
 * - `domains` enthält **Registrable Domains ohne Subdomain**, wo immer möglich.
 *   `requestDomains` deckt Subdomains automatisch ab: `example.com` matcht auch
 *   `ads.example.com`. Explizite Subdomains stehen nur dort, wo die Eltern-Domain
 *   legitim ist und nicht blockiert werden darf (z. B. `pixel.facebook.com`, aber
 *   nicht `facebook.com`).
 * - `urlFilters` ist für pfadgebundene Muster gedacht, die sich nicht als Domain
 *   ausdrücken lassen (z. B. `facebook.com/tr`).
 *
 * ## Quellen
 *
 * Die Listen stammen aus Toolz/d3Host (CC BY-NC-SA 4.0) sowie öffentlich
 * dokumentierten Tracking-Endpunkten der jeweiligen Anbieter. Siehe CREDITS.md.
 */

/**
 * @typedef {object} FilterGroup
 * @property {string[]} domains Registrable Domains; Subdomains sind eingeschlossen.
 * @property {string[]} [urlFilters] Pfadgebundene Muster in declarativeNetRequest-Syntax.
 */

/** @type {Readonly<Record<string, Record<string, FilterGroup>>>} */
export const RULE_REGISTRY = Object.freeze({
  ads: {
    google: {
      domains: [
        'googlesyndication.com',
        'googleadservices.com',
        'adservice.google.com',
        'doubleclick.net',
        'googletagservices.com',
        'adtago.s3.amazonaws.com',
        'advice-ads.s3.amazonaws.com',
      ],
    },
    social_ads: {
      domains: [
        'adcolony.com',
        'media.net',
        'ads.youtube.com',
        'ads.yahoo.com',
        'applovin.com',
        'inmobi.com',
        'vungle.com',
      ],
    },
    display: {
      domains: [
        'amazon-adsystem.com',
        'adsrvr.org',
        'adform.net',
        'pubmatic.com',
        'rubiconproject.com',
        'casalemedia.com',
        'sharethrough.com',
        'bidswitch.net',
        'yieldmo.com',
        'openx.net',
        'smartadserver.com',
        'teads.tv',
        'contextweb.com',
        '33across.com',
        'indexexchange.com',
        'quantserve.com',
        'scorecardresearch.com',
        'zemanta.com',
        'mathtag.com',
        'bluekai.com',
        'demdex.net',
        'everesttech.net',
        'adroll.com',
        'mediaplex.com',
        'zedo.com',
        'revjet.com',
        'serving-sys.com',
        'adnxs.com',
        'adsafeprotected.com',
        'bat.bing.com',
      ],
    },
    native: {
      domains: ['outbrain.com', 'taboola.com', 'criteo.com', 'criteo.net', 'revcontent.com'],
    },
  },

  analytics: {
    google_analytics: {
      domains: [
        'google-analytics.com',
        'analytics.google.com',
        'googletagmanager.com',
        'clarity.ms',
        'optimizely.com',
      ],
    },
    session_replay: {
      domains: [
        'hotjar.com',
        'hotjar.io',
        'mouseflow.com',
        'luckyorange.com',
        'luckyorange.net',
        'fullstory.com',
        'smartlook.com',
        'inspectlet.com',
        'crazyegg.com',
        'stats.wp.com',
      ],
    },
    error_tracking: {
      // Standardmäßig aus: Blockieren bricht in manchen Web-Apps das Fehler-Handling.
      domains: ['bugsnag.com', 'browser.sentry-cdn.com', 'app.getsentry.com'],
    },
    marketing: {
      domains: [
        'freshmarketer.com',
        'hubspot.com',
        'marketo.net',
        'pardot.com',
        'braze.com',
        'segment.io',
        'segment.com',
        'mixpanel.com',
        'amplitude.com',
        'heap.io',
        'kissmetrics.com',
      ],
    },
  },

  social: {
    facebook: {
      // facebook.com selbst bleibt erreichbar — nur die Tracking-Endpunkte fallen weg.
      domains: ['pixel.facebook.com', 'an.facebook.com', 'connect.facebook.net'],
      urlFilters: ['||facebook.com/tr', '||facebook.com/plugins/'],
    },
    twitter: {
      // Bewusst NICHT `t.co`: das ist der Link-Shortener von X. Wer ihn blockiert,
      // macht jeden geteilten Link unbrauchbar. v4 hatte ihn drin.
      domains: ['ads-twitter.com', 'ads-api.twitter.com', 'analytics.twitter.com'],
      urlFilters: ['||twitter.com/i/jot', '||x.com/i/jot'],
    },
    linkedin: {
      domains: ['ads.linkedin.com', 'analytics.pointdrive.linkedin.com', 'snap.licdn.com'],
    },
    pinterest: {
      domains: [
        'ads.pinterest.com',
        'log.pinterest.com',
        'analytics.pinterest.com',
        'trk.pinterest.com',
      ],
    },
    tiktok: {
      domains: [
        'ads-api.tiktok.com',
        'analytics.tiktok.com',
        'ads-sg.tiktok.com',
        'analytics-sg.tiktok.com',
        'business-api.tiktok.com',
        'ads.tiktok.com',
        'log.byteoversea.com',
      ],
    },
    reddit: {
      domains: ['events.reddit.com', 'events.redditmedia.com', 'alb.reddit.com'],
    },
  },

  annoyances: {
    content_rec: {
      domains: ['zergnet.com', 'mgid.com', 'plista.com', 'ligatus.com', 'dianomi.com'],
    },
    ad_measurement: {
      domains: ['moatads.com', 'doubleverify.com', 'iasds01.com', 'agkn.com', 'chartbeat.com'],
    },
    push_prompts: {
      domains: [
        'pushwoosh.com',
        'onesignal.com',
        'pushengage.com',
        'webpushr.com',
        'sendpulse.com',
        'izooto.com',
      ],
    },
  },

  malware: {
    cryptomining: {
      domains: [
        'coinhive.com',
        'coin-hive.com',
        'jsecoin.com',
        'cryptoloot.pro',
        'crypto-loot.com',
        'webminepool.com',
        'coinimp.com',
        'minero.cc',
        'webmine.cz',
        'authedmine.com',
      ],
    },
    scam: {
      domains: [
        'popcash.net',
        'popads.net',
        'propellerads.com',
        'adcash.com',
        'clickadu.com',
        'hilltopads.net',
        'exoclick.com',
        'juicyads.com',
      ],
    },
  },

  oem: {
    samsung: {
      domains: [
        'samsungads.com',
        'smetrics.samsung.com',
        'nmetrics.samsung.com',
        'samsung-com.112.2o7.net',
      ],
    },
    xiaomi: {
      domains: [
        'api.ad.xiaomi.com',
        'sdkconfig.ad.xiaomi.com',
        'sdkconfig.ad.intl.xiaomi.com',
        'data.mistat.xiaomi.com',
        'data.mistat.india.xiaomi.com',
        'data.mistat.rus.xiaomi.com',
        'tracking.rus.miui.com',
      ],
    },
    huawei: {
      domains: [
        'metrics.data.hicloud.com',
        'metrics2.data.hicloud.com',
        'grs.hicloud.com',
        'logservice.hicloud.com',
        'logservice1.hicloud.com',
        'logbak.hicloud.com',
      ],
    },
    oppo: {
      domains: [
        'adsfs.oppomobile.com',
        'adx.ads.oppomobile.com',
        'ck.ads.oppomobile.com',
        'data.ads.oppomobile.com',
        'iot-eu-logser.realme.com',
        'iot-logser.realme.com',
        'bdapi-ads.realmemobile.com',
        'bdapi-in-ads.realmemobile.com',
      ],
    },
    apple: {
      domains: [
        'iadsdk.apple.com',
        'api-adservices.apple.com',
        'metrics.icloud.com',
        'metrics.mzstatic.com',
        'books-analytics-events.apple.com',
        'weather-analytics-events.apple.com',
        'notes-analytics-events.apple.com',
      ],
    },
    oneplus: {
      domains: ['click.oneplus.cn', 'open.oneplus.net'],
    },
    yahoo: {
      domains: [
        'analytics.yahoo.com',
        'geo.yahoo.com',
        'udc.yahoo.com',
        'udcm.yahoo.com',
        'analytics.query.yahoo.com',
        'partnerads.ysm.yahoo.com',
        'log.fc.yahoo.com',
        'gemini.yahoo.com',
        'adtech.yahooinc.com',
      ],
    },
    yandex: {
      domains: [
        'appmetrica.yandex.ru',
        'adfstat.yandex.ru',
        'metrika.yandex.ru',
        'offerwall.yandex.net',
        'adfox.yandex.ru',
        'extmaps-api.yandex.net',
      ],
    },
    unity: {
      domains: ['unityads.unity3d.com'],
    },
  },
});

/**
 * Zählt Domains und Muster je Kategorie und Unterkategorie.
 *
 * Die UI zeigt damit an, wie viel hinter einem Schalter steckt.
 *
 * @returns {Record<string, {total: number, subcategories: Record<string, number>}>}
 */
export function getRegistryStats() {
  /** @type {Record<string, {total: number, subcategories: Record<string, number>}>} */
  const stats = {};
  for (const [categoryId, subcategories] of Object.entries(RULE_REGISTRY)) {
    /** @type {Record<string, number>} */
    const perSub = {};
    let total = 0;
    for (const [subId, group] of Object.entries(subcategories)) {
      const count = group.domains.length + (group.urlFilters?.length ?? 0);
      perSub[subId] = count;
      total += count;
    }
    stats[categoryId] = { total, subcategories: perSub };
  }
  return stats;
}

/**
 * Gesamtzahl aller mitgelieferten Einträge.
 * @returns {number}
 */
export function getTotalRegistryEntries() {
  return Object.values(getRegistryStats()).reduce((sum, entry) => sum + entry.total, 0);
}

/**
 * Entfernt Domains, die bereits durch eine allgemeinere Domain derselben Liste
 * abgedeckt sind.
 *
 * Beispiel: Steht `media.net` in der Liste, ist `static.media.net` überflüssig,
 * weil `requestDomains` Subdomains ohnehin einschließt. v4 führte beide.
 *
 * @param {readonly string[]} domains
 * @returns {string[]} Sortierte, redundanzfreie Liste.
 */
export function collapseRedundantDomains(domains) {
  const unique = [...new Set(domains.filter((d) => typeof d === 'string' && d.length > 0))];
  // Kürzeste zuerst: eine Eltern-Domain wird immer vor ihren Subdomains geprüft.
  unique.sort((a, b) => a.length - b.length || a.localeCompare(b));

  /** @type {string[]} */
  const kept = [];
  for (const domain of unique) {
    const covered = kept.some((parent) => domain === parent || domain.endsWith(`.${parent}`));
    if (!covered) kept.push(domain);
  }
  return kept.sort();
}
