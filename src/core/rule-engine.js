/**
 * Übersetzt Einstellungen in declarativeNetRequest-Regeln.
 *
 * Vollständig pur: rein → raus, kein `chrome`-Zugriff. Der Service Worker
 * übergibt das Ergebnis an `chrome.declarativeNetRequest.updateDynamicRules`.
 *
 * ## Rangfolge der Regeln
 *
 * declarativeNetRequest entscheidet nach Priorität; bei Gleichstand schlägt
 * `allow` ein `block`. Wir arbeiten mit klaren Abständen, damit die Reihenfolge
 * nicht von Implementierungsdetails abhängt:
 *
 * | Priorität | Herkunft            | Wirkung                                   |
 * |-----------|---------------------|-------------------------------------------|
 * | 1000      | Whitelist           | hebt auf freigegebenen Seiten alles auf   |
 * | 100       | Eigene Regeln       | schlagen mitgelieferte Listen             |
 * | 10        | Kategorien          | die mitgelieferte Registry                |
 * | 1         | Heruntergeladene Listen | breite Abdeckung, schwächste Stimme   |
 *
 * ## Warum Whitelisting jetzt über Allow-Regeln läuft
 *
 * v4 hängte an *jede* Block-Regel ein `excludedInitiatorDomains` mit der gesamten
 * Whitelist. Das vervielfacht die Datenmenge (Whitelist × Regelanzahl), muss bei
 * jeder Whitelist-Änderung komplett neu geschrieben werden und greift nicht für
 * Requests ohne Initiator. Eine einzelne `allowAllRequests`-Regel auf dem
 * Hauptdokument erledigt dasselbe korrekt und kostet eine Regel pro 500 Domains.
 */

import {
  BLOCKABLE_RESOURCE_TYPES,
  DYNAMIC_RULE_SAFE_LIMIT,
  MAX_DOMAINS_PER_RULE,
  RULE_ID_RANGES,
  RULE_PRIORITY,
} from './constants.js';
import { RULE_REGISTRY, collapseRedundantDomains } from './rule-registry.js';
import { PRESET_SOURCE_HOSTS } from './presets.js';

/**
 * Baut die Schutz-Allow-Regeln für die Bezugsquellen der Filterlisten.
 *
 * Diese Regeln sind immer Teil des Regelsatzes, unabhängig von jeder
 * Einstellung, und tragen die höchste Priorität.
 *
 * Der Grund ist eine konkrete Erfahrung aus v5.0.0: Aus der Zeile
 * `|https:$domain=adfarm1.adition.com` in EasyList Germany wurde eine Regel, die
 * jede HTTPS-Anfrage blockierte — einschließlich des Downloads eben jener Liste.
 * Die Erweiterung konnte sich nicht mehr selbst reparieren, weil die Reparatur
 * genau durch den Fehler verhindert wurde, den sie beheben sollte.
 *
 * Die Kosten sind gering: eine Handvoll Regeln für eine Handvoll Hosts, die
 * ohnehin niemand blockieren möchte. Der Nutzen ist, dass ein Fehler dieser Art
 * behebbar bleibt.
 *
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildSelfProtectionRules() {
  const hosts = collapseRedundantDomains([...PRESET_SOURCE_HOSTS]);
  if (hosts.length === 0) return [];

  /** @type {chrome.declarativeNetRequest.Rule[]} */
  const rules = [];
  let nextId = RULE_ID_RANGES.SELF_PROTECTION.start;

  for (const block of chunk(hosts, MAX_DOMAINS_PER_RULE)) {
    if (nextId > RULE_ID_RANGES.SELF_PROTECTION.end) break;
    rules.push({
      id: nextId++,
      priority: RULE_PRIORITY.SELF_PROTECTION,
      action: { type: 'allow' },
      condition: {
        requestDomains: block,
        // Bewusst alle Typen einschließlich `main_frame`: Der Nutzer soll die
        // Listen auch im Browser aufrufen können, um sie selbst zu prüfen.
        resourceTypes: [...new Set(['main_frame', ...BLOCKABLE_RESOURCE_TYPES])],
      },
    });
  }

  return rules;
}

/**
 * Teilt ein Array in Blöcke fester Größe.
 * @template T
 * @param {readonly T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  if (size <= 0) return [items.slice()];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Baut die Allow-Regeln für die Whitelist.
 *
 * Zwei Regeltypen pro Domain-Block:
 *  1. `allowAllRequests` auf dem Dokument-Request — hebt das Blockieren für alle
 *     Unter-Requests dieses Dokuments auf.
 *  2. `allow` auf Requests, die von der Seite ausgehen — fängt Fälle ab, in denen
 *     Regel 1 nicht greift (etwa Service-Worker-Requests der Seite).
 *
 * @param {readonly string[]} whitelist
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildAllowRules(whitelist) {
  const domains = collapseRedundantDomains(whitelist ?? []);
  if (domains.length === 0) return [];

  /** @type {chrome.declarativeNetRequest.Rule[]} */
  const rules = [];
  let nextId = RULE_ID_RANGES.ALLOW.start;

  for (const block of chunk(domains, MAX_DOMAINS_PER_RULE)) {
    if (nextId + 1 > RULE_ID_RANGES.ALLOW.end) break;

    rules.push({
      id: nextId++,
      priority: RULE_PRIORITY.ALLOW,
      action: { type: 'allowAllRequests' },
      condition: {
        requestDomains: block,
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    });

    rules.push({
      id: nextId++,
      priority: RULE_PRIORITY.ALLOW,
      action: { type: 'allow' },
      condition: {
        initiatorDomains: block,
        resourceTypes: [...BLOCKABLE_RESOURCE_TYPES],
      },
    });
  }

  return rules;
}

/**
 * Sammelt die Domains und Muster aller aktiven Unterkategorien.
 *
 * @param {import('./settings.js').Settings} settings
 * @returns {{domains: string[], urlFilters: string[], activeSubcategories: string[]}}
 */
export function collectActiveFilters(settings) {
  /** @type {string[]} */
  const domains = [];
  /** @type {string[]} */
  const urlFilters = [];
  /** @type {string[]} */
  const activeSubcategories = [];

  for (const [categoryId, subcategories] of Object.entries(RULE_REGISTRY)) {
    const categorySettings = settings.categories?.[categoryId];
    if (!categorySettings?.enabled) continue;

    for (const [subId, group] of Object.entries(subcategories)) {
      // Fehlt der Eintrag (z. B. neue Unterkategorie nach einem Update), gilt der
      // Standard aus der Normalisierung — hier zählt nur ein explizites `false`.
      if (categorySettings.subcategories?.[subId]?.enabled === false) continue;

      activeSubcategories.push(`${categoryId}.${subId}`);
      domains.push(...group.domains);
      if (group.urlFilters) urlFilters.push(...group.urlFilters);
    }
  }

  return {
    // Zusammenführen über Kategoriegrenzen hinweg: `outbrain.com` steht in v4
    // gleich zweimal in der Registry. Doppelte Regeln kosten nur Kontingent.
    domains: collapseRedundantDomains(domains),
    urlFilters: [...new Set(urlFilters)],
    activeSubcategories,
  };
}

/**
 * Baut die Blockier-Regeln für die mitgelieferten Kategorien.
 * @param {import('./settings.js').Settings} settings
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildCategoryRules(settings) {
  const { domains, urlFilters } = collectActiveFilters(settings);
  /** @type {chrome.declarativeNetRequest.Rule[]} */
  const rules = [];
  let nextId = RULE_ID_RANGES.CATEGORY.start;

  for (const block of chunk(domains, MAX_DOMAINS_PER_RULE)) {
    if (nextId > RULE_ID_RANGES.CATEGORY.end) break;
    rules.push({
      id: nextId++,
      priority: RULE_PRIORITY.STATIC,
      action: { type: 'block' },
      condition: {
        requestDomains: block,
        resourceTypes: [...BLOCKABLE_RESOURCE_TYPES],
      },
    });
  }

  for (const urlFilter of urlFilters) {
    if (nextId > RULE_ID_RANGES.CATEGORY.end) break;
    rules.push({
      id: nextId++,
      priority: RULE_PRIORITY.STATIC,
      action: { type: 'block' },
      condition: {
        urlFilter,
        resourceTypes: [...BLOCKABLE_RESOURCE_TYPES],
      },
    });
  }

  return rules;
}

/**
 * Baut die Regeln für selbst angelegte Filter.
 * @param {import('./settings.js').Settings} settings
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildCustomRules(settings) {
  const customRules = settings.customRules ?? [];
  const capacity = RULE_ID_RANGES.CUSTOM.end - RULE_ID_RANGES.CUSTOM.start + 1;

  return customRules.slice(0, capacity).map((rule, index) => ({
    id: RULE_ID_RANGES.CUSTOM.start + index,
    priority: RULE_PRIORITY.CUSTOM,
    action: { type: 'block' },
    condition: {
      urlFilter: rule.urlFilter,
      resourceTypes: [...BLOCKABLE_RESOURCE_TYPES],
    },
  }));
}

/**
 * Weist Regeln aus Filterlisten IDs im Preset-Bereich zu.
 * @param {readonly chrome.declarativeNetRequest.Rule[]} presetRules Regeln ohne endgültige ID.
 * @param {number} budget Wie viele Regeln noch in das Kontingent passen.
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function assignPresetRuleIds(presetRules, budget) {
  const usable = Math.max(0, Math.min(budget, presetRules.length));
  return presetRules.slice(0, usable).map((rule, index) => ({
    ...rule,
    id: RULE_ID_RANGES.PRESET.start + index,
    priority: RULE_PRIORITY.PRESET,
  }));
}

/**
 * Stellt den vollständigen Satz dynamischer Regeln zusammen.
 *
 * Die Reihenfolge des Budgets ist bewusst gewählt: Whitelist, eigene Regeln und
 * Kategorien sind gesetzt; nur die heruntergeladenen Listen werden gekürzt, wenn
 * das Kontingent nicht reicht. Die Kürzung wird zurückgemeldet, damit die
 * Oberfläche sie anzeigen kann, statt sie stillschweigend zu verschlucken —
 * v4 lief hier ohne Warnung in einen API-Fehler und verlor **alle** Regeln.
 *
 * @param {object} input
 * @param {import('./settings.js').Settings} input.settings
 * @param {readonly chrome.declarativeNetRequest.Rule[]} [input.presetRules]
 * @param {number} [input.maxRules] Vom Browser gemeldetes Limit.
 * @returns {{
 *   rules: chrome.declarativeNetRequest.Rule[],
 *   counts: {allow: number, custom: number, category: number, preset: number, total: number},
 *   truncatedPresetRules: number
 * }}
 */
export function buildDynamicRuleSet({
  settings,
  presetRules = [],
  maxRules = DYNAMIC_RULE_SAFE_LIMIT,
}) {
  // Master-Schalter aus: gar nichts blockieren. Die Allow-Regeln entfallen dann
  // ebenfalls, weil es nichts aufzuheben gibt.
  if (!settings.masterEnabled) {
    return {
      rules: [],
      counts: { selfProtection: 0, allow: 0, custom: 0, category: 0, preset: 0, total: 0 },
      truncatedPresetRules: presetRules.length,
    };
  }

  const selfProtection = buildSelfProtectionRules();
  const allow = buildAllowRules(settings.whitelist);
  const custom = buildCustomRules(settings);
  const category = buildCategoryRules(settings);

  const reserved = selfProtection.length + allow.length + custom.length + category.length;
  const budget = Math.max(0, maxRules - reserved);
  const preset = assignPresetRuleIds(presetRules, budget);

  return {
    rules: [...selfProtection, ...allow, ...custom, ...category, ...preset],
    counts: {
      selfProtection: selfProtection.length,
      allow: allow.length,
      custom: custom.length,
      category: category.length,
      preset: preset.length,
      total: reserved + preset.length,
    },
    truncatedPresetRules: Math.max(0, presetRules.length - preset.length),
  };
}

/**
 * Berechnet die minimale Änderung zwischen zwei Regelsätzen.
 *
 * v4 löschte bei jeder noch so kleinen Änderung sämtliche dynamischen Regeln und
 * schrieb sie neu — zwei API-Aufrufe und ein Zeitfenster, in dem gar nichts
 * blockiert war. Hier wird nur der tatsächliche Unterschied geschrieben, und bei
 * Gleichheit passiert überhaupt nichts.
 *
 * @param {readonly chrome.declarativeNetRequest.Rule[]} existing
 * @param {readonly chrome.declarativeNetRequest.Rule[]} next
 * @returns {{removeRuleIds: number[], addRules: chrome.declarativeNetRequest.Rule[], unchanged: boolean}}
 */
export function computeRuleUpdate(existing, next) {
  const existingById = new Map(existing.map((rule) => [rule.id, rule]));
  const nextById = new Map(next.map((rule) => [rule.id, rule]));

  /** @type {number[]} */
  const removeRuleIds = [];
  /** @type {chrome.declarativeNetRequest.Rule[]} */
  const addRules = [];

  for (const [id, rule] of existingById) {
    const replacement = nextById.get(id);
    // Weg oder inhaltlich verändert → alte Regel muss raus.
    if (!replacement || !isSameRule(rule, replacement)) removeRuleIds.push(id);
  }

  for (const [id, rule] of nextById) {
    const previous = existingById.get(id);
    if (!previous || !isSameRule(previous, rule)) addRules.push(rule);
  }

  return {
    removeRuleIds,
    addRules,
    unchanged: removeRuleIds.length === 0 && addRules.length === 0,
  };
}

/**
 * Vergleicht zwei Regeln inhaltlich.
 *
 * Schlüsselreihenfolge ist irrelevant, Arrays werden sortiert verglichen — der
 * Browser liefert `getDynamicRules()` nicht zwingend in derselben Form zurück,
 * in der wir die Regeln geschrieben haben.
 *
 * @param {chrome.declarativeNetRequest.Rule} a
 * @param {chrome.declarativeNetRequest.Rule} b
 * @returns {boolean}
 */
export function isSameRule(a, b) {
  return canonicalize(a) === canonicalize(b);
}

/**
 * Erzeugt eine stabile Textdarstellung eines Werts.
 * @param {unknown} value
 * @returns {string}
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).sort().join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => `${key}:${canonicalize(entryValue)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
