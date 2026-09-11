/**
 * Beschreibung des Einstellungs-Schemas: Kategorien, Unterkategorien, Standardwerte.
 *
 * Die Taxonomie (Labels, Beschreibungen, Icons) ist bewusst von den *Nutzerwerten*
 * getrennt. In v4 lagen beide zusammen im Storage: jedes Speichern schrieb die
 * kompletten deutschen Beschreibungstexte mit — was das 8-KB-Limit pro Eintrag von
 * `chrome.storage.sync` sprengte und dazu führte, dass Labels nach einem Update
 * veraltet im Storage stehen blieben.
 *
 * Jetzt gilt: Der Storage hält nur noch Booleans. Alles Beschreibende kommt aus
 * dieser Datei und ist damit bei jedem Update automatisch aktuell.
 */

import { SETTINGS_SCHEMA_VERSION } from './constants.js';

/**
 * @typedef {object} SubcategoryMeta
 * @property {string} label Anzeigename.
 * @property {string} description Ein Satz, der erklärt, was passiert.
 * @property {boolean} defaultEnabled Standard bei Neuinstallation.
 * @property {boolean} [breaksSites] Markiert Filter, die erfahrungsgemäß Seiten beschädigen.
 */

/**
 * @typedef {object} CategoryMeta
 * @property {string} label
 * @property {string} description
 * @property {string} icon Iconify-Name.
 * @property {boolean} defaultEnabled
 * @property {Record<string, SubcategoryMeta>} subcategories
 */

/**
 * Vollständige Taxonomie.
 * @type {Readonly<Record<string, CategoryMeta>>}
 */
export const CATEGORY_TAXONOMY = Object.freeze({
  ads: {
    label: 'Werbung',
    description: 'Blockiert Anzeigen, Banner und Werbenetzwerke.',
    icon: 'mdi:shield-check',
    defaultEnabled: true,
    subcategories: {
      google: {
        label: 'Google Ads',
        description: 'Google-Werbung, AdSense und DoubleClick.',
        defaultEnabled: true,
      },
      social_ads: {
        label: 'Social Ads',
        description: 'Werbeauslieferung über soziale Netzwerke.',
        defaultEnabled: true,
      },
      display: {
        label: 'Display Ads',
        description: 'Banner, Pop-ups und Videowerbung großer Ad-Exchanges.',
        defaultEnabled: true,
      },
      native: {
        label: 'Native Ads',
        description: 'Als Inhalt getarnte Werbung (Taboola, Outbrain, Criteo).',
        defaultEnabled: true,
      },
    },
  },

  analytics: {
    label: 'Tracker',
    description: 'Blockiert Analyse- und Tracking-Dienste.',
    icon: 'mdi:chart-bar',
    defaultEnabled: true,
    subcategories: {
      google_analytics: {
        label: 'Google Analytics',
        description: 'Analytics, Tag Manager und verwandte Messdienste.',
        defaultEnabled: true,
      },
      session_replay: {
        label: 'Session Replay',
        description: 'Dienste, die Mausbewegungen und Eingaben aufzeichnen.',
        defaultEnabled: true,
      },
      error_tracking: {
        label: 'Fehler-Tracking',
        description: 'Sentry, Bugsnag & Co. Blockieren kann Web-Apps stören.',
        defaultEnabled: false,
        breaksSites: true,
      },
      marketing: {
        label: 'Marketing-Analytics',
        description: 'Kampagnenmessung und Conversion-Tracking.',
        defaultEnabled: true,
      },
    },
  },

  social: {
    label: 'Social Media',
    description: 'Blockiert Tracking durch soziale Netzwerke.',
    icon: 'mdi:account-group',
    defaultEnabled: true,
    subcategories: {
      facebook: {
        label: 'Facebook / Meta',
        description: 'Facebook-Pixel und Meta-Tracker.',
        defaultEnabled: true,
      },
      twitter: {
        label: 'X / Twitter',
        description: 'X-Werbung und Tracking-Endpunkte.',
        defaultEnabled: true,
      },
      linkedin: {
        label: 'LinkedIn',
        description: 'LinkedIn Insight Tag und Anzeigen.',
        defaultEnabled: true,
      },
      pinterest: {
        label: 'Pinterest',
        description: 'Pinterest-Tag und Anzeigen.',
        defaultEnabled: true,
      },
      tiktok: {
        label: 'TikTok',
        description: 'TikTok-Pixel und Werbe-APIs.',
        defaultEnabled: true,
      },
      reddit: {
        label: 'Reddit',
        description: 'Reddit-Events und Conversion-Tracking.',
        defaultEnabled: true,
      },
    },
  },

  annoyances: {
    label: 'Störendes',
    description: 'Blockiert Empfehlungs-Widgets und Werbemessung.',
    icon: 'mdi:bell-off-outline',
    defaultEnabled: true,
    subcategories: {
      content_rec: {
        label: 'Content-Empfehlungen',
        description: '„Das könnte Sie auch interessieren“-Widgets.',
        defaultEnabled: true,
      },
      ad_measurement: {
        label: 'Werbemessung',
        description: 'Sichtbarkeits- und Betrugsmessung (Moat, DoubleVerify).',
        defaultEnabled: true,
      },
      push_prompts: {
        label: 'Push-Aufforderungen',
        description: 'Dienste hinter aufdringlichen Benachrichtigungs-Abfragen.',
        defaultEnabled: true,
      },
    },
  },

  malware: {
    label: 'Schadsoftware & Betrug',
    description: 'Blockiert bekannte Malware-, Phishing- und Krypto-Miner-Domains.',
    icon: 'mdi:bug-outline',
    defaultEnabled: true,
    subcategories: {
      cryptomining: {
        label: 'Krypto-Mining',
        description: 'Skripte, die im Browser unbemerkt Kryptowährung schürfen.',
        defaultEnabled: true,
      },
      scam: {
        label: 'Betrugsnetzwerke',
        description: 'Bekannte Netzwerke für Fake-Support und Abo-Fallen.',
        defaultEnabled: true,
      },
    },
  },

  oem: {
    label: 'Hersteller-Telemetrie',
    description: 'Blockiert Telemetrie von Geräteherstellern und Plattformen.',
    icon: 'mdi:cellphone-cog',
    defaultEnabled: false,
    subcategories: {
      samsung: {
        label: 'Samsung',
        description: 'Samsung Ads und Analytics.',
        defaultEnabled: true,
      },
      xiaomi: { label: 'Xiaomi', description: 'MIUI-Tracking und Werbung.', defaultEnabled: true },
      huawei: { label: 'Huawei', description: 'HiCloud-Telemetrie.', defaultEnabled: true },
      oppo: {
        label: 'Oppo / Realme',
        description: 'Oppo- und Realme-Tracking.',
        defaultEnabled: true,
      },
      apple: {
        label: 'Apple',
        description: 'Apple Ad Services und App-Telemetrie.',
        defaultEnabled: true,
      },
      oneplus: { label: 'OnePlus', description: 'OnePlus-Telemetrie.', defaultEnabled: true },
      yahoo: { label: 'Yahoo', description: 'Yahoo-Werbung und Analytics.', defaultEnabled: true },
      yandex: { label: 'Yandex', description: 'Yandex Metrica und AdFox.', defaultEnabled: true },
      unity: {
        label: 'Unity Ads',
        description: 'Werbung aus Unity-Spielen.',
        defaultEnabled: true,
      },
    },
  },
});

/**
 * Zuordnung Schutzstufe → aktive Kategorien.
 *
 * Nur die **Kategorien** werden von der Stufe gesteuert. Unterkategorien bleiben
 * unangetastet — in v4 überschrieb der Schieberegler das komplette
 * `categories`-Objekt und löschte damit jede Feineinstellung des Nutzers.
 */
export const PROTECTION_LEVEL_PRESETS = Object.freeze({
  0: Object.freeze({
    ads: false,
    analytics: false,
    social: false,
    annoyances: false,
    malware: false,
    oem: false,
  }),
  25: Object.freeze({
    ads: true,
    analytics: false,
    social: false,
    annoyances: false,
    malware: true,
    oem: false,
  }),
  50: Object.freeze({
    ads: true,
    analytics: true,
    social: false,
    annoyances: false,
    malware: true,
    oem: false,
  }),
  75: Object.freeze({
    ads: true,
    analytics: true,
    social: true,
    annoyances: true,
    malware: true,
    oem: false,
  }),
  100: Object.freeze({
    ads: true,
    analytics: true,
    social: true,
    annoyances: true,
    malware: true,
    oem: true,
  }),
});

/** Lesbare Bezeichnung je Schutzstufe. */
export const PROTECTION_LEVEL_LABELS = Object.freeze({
  0: 'Aus',
  25: 'Minimal',
  50: 'Standard',
  75: 'Hoch',
  100: 'Maximum',
});

/** Erklärungstext je Schutzstufe für das Popup. */
export const PROTECTION_LEVEL_HINTS = Object.freeze({
  0: 'pBlock blockiert nichts. Nutze das nur zum kurzen Gegentesten.',
  25: 'Nur Werbung und Schadsoftware. Am verträglichsten für empfindliche Seiten.',
  50: 'Werbung, Schadsoftware und Tracker. Empfohlen für den Alltag.',
  75: 'Zusätzlich Social-Media-Tracking und störende Widgets.',
  100: 'Alles inklusive Hersteller-Telemetrie. Kann einzelne Seiten beeinträchtigen.',
});

/**
 * Erzeugt die Standard-Kategorieeinstellungen (nur Booleans) aus der Taxonomie.
 * @returns {Record<string, {enabled: boolean, subcategories: Record<string, {enabled: boolean}>}>}
 */
export function buildDefaultCategories() {
  /** @type {Record<string, {enabled: boolean, subcategories: Record<string, {enabled: boolean}>}>} */
  const categories = {};
  for (const [categoryId, meta] of Object.entries(CATEGORY_TAXONOMY)) {
    /** @type {Record<string, {enabled: boolean}>} */
    const subcategories = {};
    for (const [subId, subMeta] of Object.entries(meta.subcategories)) {
      subcategories[subId] = { enabled: subMeta.defaultEnabled };
    }
    categories[categoryId] = { enabled: meta.defaultEnabled, subcategories };
  }
  return categories;
}

/**
 * Frische Standardeinstellungen.
 *
 * Bewusst als Funktion statt als eingefrorenes Objekt: Aufrufer bekommen eine
 * eigene Kopie und können sie gefahrlos weiterverarbeiten.
 *
 * @returns {import('./settings.js').Settings}
 */
export function createDefaultSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    masterEnabled: true,
    /** 'simple' zeigt nur den Schieberegler, 'expert' die Einzelschalter. */
    uiMode: 'simple',
    protectionLevel: 50,
    categories: buildDefaultCategories(),
    whitelist: [],
    customRules: [],
    elementRules: [],
    cosmeticFiltersEnabled: true,
    antiAdblockDefuseEnabled: true,
    ui: {
      showBadge: true,
      showNotifications: false,
      theme: 'system',
      reduceMotion: false,
    },
    diagnostics: {
      logLevel: 'warn',
    },
  };
}
