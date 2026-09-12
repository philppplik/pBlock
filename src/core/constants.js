/**
 * Zentrale Konstanten für pBlock.
 *
 * Grundsatz: Magische Zahlen und Strings leben hier, nicht verstreut im Code.
 * Jede Änderung an Limits oder ID-Bereichen ist damit an genau einer Stelle nachvollziehbar.
 */

/** Schema-Version der persistierten Einstellungen. Erhöhen, wenn eine Migration nötig wird. */
export const SETTINGS_SCHEMA_VERSION = 5;

/** Schema-Version der persistierten Statistik. */
export const STATS_SCHEMA_VERSION = 5;

/** Schlüssel in `chrome.storage.local`. */
export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'settings',
  STATISTICS: 'statistics',
  SITE_STATS: 'siteStats',
  PRESET_META: 'presetMeta',
  PRESET_RULES: 'presetRules',
  DIAGNOSTICS: 'diagnostics',
  ONBOARDING: 'onboarding',
});

/**
 * ID-Bereiche für dynamische declarativeNetRequest-Regeln.
 *
 * Statische Regeln (Kategorien) leben in eigenen Rulesets und brauchen nur
 * ruleset-lokale IDs. Dynamische Regeln teilen sich dagegen einen globalen
 * Namensraum — Überschneidungen führen zu `updateDynamicRules`-Fehlern.
 */
export const RULE_ID_RANGES = Object.freeze({
  /**
   * Schutz-Allow-Regeln für die Bezugsquellen der Filterlisten.
   *
   * Sie stehen ganz oben und sind immer vorhanden. In v5.0.0 erzeugte eine
   * einzige fehlerhaft übersetzte Zeile aus EasyList Germany (`|https:`) eine
   * Regel, die jede HTTPS-Anfrage blockierte — auch den Download der Liste, die
   * sie wieder entfernt hätte. Aus diesem Zustand kam die Erweiterung nicht mehr
   * heraus. Diese Regeln stellen sicher, dass eine Reparatur immer ankommt.
   */
  SELF_PROTECTION: { start: 1, end: 99 },
  /** Allow-Regeln für die Whitelist. */
  ALLOW: { start: 100, end: 999 },
  /** Vom Nutzer selbst angelegte Blockier-Regeln. */
  CUSTOM: { start: 1_000, end: 9_999 },
  /** Aus der mitgelieferten Registry erzeugte Kategorie-Regeln. */
  CATEGORY: { start: 10_000, end: 19_999 },
  /** Aus heruntergeladenen Filterlisten erzeugte Regeln. */
  PRESET: { start: 20_000, end: 1_000_000 },
});

/**
 * Maximale Anzahl Domains in einer einzelnen `requestDomains`-Bedingung.
 *
 * Chrome begrenzt die Summe der Domain-Einträge pro Regel. Wir bleiben bewusst
 * deutlich darunter und teilen längere Listen auf mehrere Regeln auf.
 */
export const MAX_DOMAINS_PER_RULE = 500;

/**
 * Prioritäten. Höhere Zahl gewinnt; bei Gleichstand schlägt `allow` ein `block`.
 * Wir arbeiten bewusst mit deutlichem Abstand, damit die Rangfolge eindeutig bleibt.
 */
export const RULE_PRIORITY = Object.freeze({
  /** Schlägt alles, auch die Whitelist-Regeln. */
  SELF_PROTECTION: 2_000,
  ALLOW: 1_000,
  CUSTOM: 100,
  STATIC: 10,
  PRESET: 1,
});

/**
 * Konservative Obergrenze für dynamische Regeln.
 *
 * Chrome garantiert `MAX_NUMBER_OF_DYNAMIC_RULES` = 5.000; neuere Versionen
 * erlauben deutlich mehr. Zur Laufzeit lesen wir den echten Wert aus der API und
 * nutzen diesen Wert nur als Rückfallebene.
 */
export const DYNAMIC_RULE_SAFE_LIMIT = 4_500;

/** Ressourcentypen, die geblockt werden. `main_frame` fehlt absichtlich: sonst zerschießt man Navigationen. */
export const BLOCKABLE_RESOURCE_TYPES = Object.freeze([
  'script',
  'image',
  'sub_frame',
  'xmlhttprequest',
  'stylesheet',
  'font',
  'media',
  'ping',
  'websocket',
  'other',
]);

/** Schutzstufen des Simple-Modus. */
export const PROTECTION_LEVELS = Object.freeze([0, 25, 50, 75, 100]);

/** Wie viele Tage Verlauf wir aufbewahren. */
export const HISTORY_RETENTION_DAYS = 90;

/** Wie viele Domains in der Bestenliste gehalten werden. */
export const TOP_DOMAIN_LIMIT = 100;

/** Wie viele Sites in der Per-Site-Statistik gehalten werden. */
export const SITE_STATS_LIMIT = 500;

/**
 * Geschätzte Durchschnittsgrößen pro Ressourcentyp in Bytes.
 *
 * Das ist eine Schätzung, keine Messung — die DNR-API meldet keine Bytes für
 * Requests, die nie stattgefunden haben. Die UI kennzeichnet den Wert als „ca.“.
 */
export const AVG_RESOURCE_SIZES = Object.freeze({
  script: 50 * 1024,
  image: 100 * 1024,
  stylesheet: 20 * 1024,
  sub_frame: 200 * 1024,
  xmlhttprequest: 10 * 1024,
  font: 80 * 1024,
  media: 500 * 1024,
  ping: 1 * 1024,
  websocket: 5 * 1024,
  other: 10 * 1024,
});

/** Farben pro Kategorie — geteilt zwischen Popup, Optionen und Diagrammen. */
export const CATEGORY_COLORS = Object.freeze({
  ads: '#E5484D',
  analytics: '#3E9EFF',
  social: '#A275F5',
  annoyances: '#F0883E',
  oem: '#8B949E',
  custom: '#3FB950',
  presets: '#59C1E8',
});
