/**
 * Einstellungsseite.
 *
 * Aufbau wie im Popup: ein `state`, Renderfunktionen je Bereich, Ereignisse
 * ändern den Zustand über den Service Worker und lösen ein Neuzeichnen aus.
 *
 * Kein `innerHTML` mit Nutzerwerten — v4 setzte Domains, Selektoren und
 * Listennamen per Template-String zusammen. Alles hier läuft über `textContent`.
 */

import { MSG } from '../../core/messages.js';
import { CATEGORY_COLORS, PROTECTION_LEVELS } from '../../core/constants.js';
import { formatBytes, formatCount } from '../../core/statistics.js';
import {
  $,
  applyTheme,
  confirmAction,
  downloadFile,
  formatRelativeTime,
  h,
  readFileAsText,
  send,
  toast,
} from '../shared/ui-kit.js';

/** @type {any} */
let state = null;
let elementFilter = 'all';
/** @type {Set<string>} */
const expandedCategories = new Set();

// ==================== Navigation ====================

/**
 * Wechselt den Bereich.
 * @param {string} page
 */
function navigate(page) {
  for (const button of document.querySelectorAll('.sidebar__nav button')) {
    button.setAttribute('aria-selected', String(button.dataset.page === page));
  }
  for (const section of document.querySelectorAll('.page')) {
    section.hidden = section.id !== `page-${page}`;
  }
  // Im Verlauf hinterlegen, damit Links wie `options.html#elements` funktionieren
  // und der Zurück-Knopf des Browsers etwas Sinnvolles tut.
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'diagnostics') loadDiagnostics();
}

for (const button of document.querySelectorAll('.sidebar__nav button')) {
  button.addEventListener('click', () => navigate(button.dataset.page));
}

// ==================== Laden ====================

/** Holt den Zustand und zeichnet alles. */
async function load() {
  const response = await send(MSG.GET_OPTIONS_STATE);
  if (!response.ok) {
    toast(response.error?.message ?? 'Die Einstellungen konnten nicht geladen werden.', 'error');
    return;
  }

  state = response.data;
  applyTheme(state.settings.ui);
  renderAll();
}

/** Zeichnet alle Bereiche. */
function renderAll() {
  renderOverview();
  renderFilters();
  renderLists();
  renderWhitelist();
  renderElements();
  renderStats();

  $('#app-version').textContent = `Version ${chrome.runtime.getManifest().version}`;
  const master = /** @type {HTMLInputElement} */ ($('#master-toggle'));
  master.checked = state.settings.masterEnabled;
  $('#sidebar-master-label').textContent = state.settings.masterEnabled
    ? 'Schutz aktiv'
    : 'Schutz pausiert';
}

// ==================== Übersicht ====================

function renderOverview() {
  const { summary, settings, history } = state;

  $('#ov-today').textContent = formatCount(summary.today);
  $('#ov-week').textContent = formatCount(summary.week);
  $('#ov-total').textContent = formatCount(summary.total);
  $('#ov-bandwidth').textContent = formatBytes(summary.bandwidthBytes);

  // Diagramm
  const chart = $('#ov-chart');
  chart.replaceChildren();
  const max = Math.max(...history.map((day) => day.count), 1);

  for (const day of history) {
    const bar = h('div', {
      class: 'chart__bar',
      attrs: {
        // Mindesthöhe, damit auch ein Tag mit wenigen Treffern sichtbar bleibt.
        style: `height:${Math.max(2, (day.count / max) * 100)}%`,
        title: `${day.label}: ${formatCount(day.count)} blockiert`,
      },
    });
    chart.appendChild(
      h('div', {
        class: 'chart__col',
        children: [bar, h('span', { class: 'chart__label', text: day.label })],
      })
    );
  }
  chart.setAttribute(
    'aria-label',
    `Blockierte Anfragen der letzten ${history.length} Tage. Höchstwert ${formatCount(max)}.`
  );

  // Modusauswahl
  for (const button of document.querySelectorAll('#mode-picker button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === settings.uiMode));
  }

  // Darstellung
  /** @type {HTMLSelectElement} */ ($('#theme-select')).value = settings.ui.theme;
  /** @type {HTMLInputElement} */ ($('#badge-toggle')).checked = settings.ui.showBadge;
  /** @type {HTMLInputElement} */ ($('#motion-toggle')).checked = settings.ui.reduceMotion;
  /** @type {HTMLInputElement} */ ($('#notify-toggle')).checked = settings.ui.showNotifications;
}

// ==================== Filter ====================

function renderFilters() {
  const { settings, taxonomy, registryStats } = state;

  // Schutzstufe
  $('#level-card').hidden = settings.uiMode !== 'simple';
  $('#level-hint').textContent = state.levelHints[settings.protectionLevel] ?? '';

  const levelButtons = $('#level-buttons');
  levelButtons.replaceChildren();
  for (const level of PROTECTION_LEVELS) {
    const button = h('button', {
      text: state.levelLabels[level],
      attrs: { type: 'button', 'aria-pressed': String(level === settings.protectionLevel) },
    });
    button.addEventListener('click', () => act(MSG.SET_PROTECTION_LEVEL, { level }));
    levelButtons.appendChild(button);
  }

  // Kategorien
  const container = $('#filters-list');
  container.replaceChildren();

  for (const [id, meta] of Object.entries(taxonomy)) {
    const config = settings.categories[id];
    if (!config) continue;
    container.appendChild(buildCategoryCard(id, meta, config, registryStats[id]));
  }

  // Cosmetic
  /** @type {HTMLInputElement} */ ($('#cosmetic-toggle')).checked = settings.cosmeticFiltersEnabled;
  /** @type {HTMLInputElement} */ ($('#antiadblock-toggle')).checked =
    settings.antiAdblockDefuseEnabled;

  renderCustomRules();
}

/**
 * Baut die Karte einer Kategorie.
 * @param {string} id
 * @param {any} meta
 * @param {any} config
 * @param {any} stats
 * @returns {HTMLElement}
 */
function buildCategoryCard(id, meta, config, stats) {
  const isOpen = expandedCategories.has(id);

  const toggle = /** @type {HTMLInputElement} */ (
    h('input', { attrs: { type: 'checkbox', 'aria-label': `Kategorie ${meta.label}` } })
  );
  toggle.checked = config.enabled;
  toggle.addEventListener('change', () =>
    act(MSG.SET_CATEGORY, { categoryId: id, enabled: toggle.checked })
  );

  const expand = h('button', {
    class: 'category-card__expand',
    text: isOpen ? 'Weniger' : `${Object.keys(meta.subcategories).length} Unterfilter`,
    attrs: { type: 'button', 'aria-expanded': String(isOpen) },
  });

  const sublist = h('ul', { class: 'subcategories' });
  sublist.hidden = !isOpen;

  for (const [subId, subMeta] of Object.entries(meta.subcategories)) {
    const subConfig = config.subcategories[subId];
    if (!subConfig) continue;

    const subToggle = /** @type {HTMLInputElement} */ (
      h('input', { attrs: { type: 'checkbox', 'aria-label': subMeta.label } })
    );
    subToggle.checked = subConfig.enabled;
    // Ein Unterfilter ohne aktive Kategorie hat keine Wirkung — das soll man sehen.
    subToggle.disabled = !config.enabled;
    subToggle.addEventListener('change', () =>
      act(MSG.SET_SUBCATEGORY, {
        categoryId: id,
        subcategoryId: subId,
        enabled: subToggle.checked,
      })
    );

    const name = h('span', { class: 'subcategory__name' });
    name.appendChild(h('span', { text: subMeta.label }));
    if (subMeta.breaksSites) {
      name.appendChild(h('span', { class: 'tag tag--warn', text: 'kann Seiten stören' }));
    }

    sublist.appendChild(
      h('li', {
        class: 'subcategory',
        children: [
          h('span', {
            class: 'subcategory__body',
            children: [name, h('span', { class: 'subcategory__desc', text: subMeta.description })],
          }),
          h('span', { class: 'entry__meta', text: `${stats?.subcategories[subId] ?? 0}` }),
          h('span', {
            class: 'switch',
            children: [subToggle, h('span', { class: 'switch__track' })],
          }),
        ],
      })
    );
  }

  expand.addEventListener('click', () => {
    if (expandedCategories.has(id)) expandedCategories.delete(id);
    else expandedCategories.add(id);
    renderFilters();
  });

  return h('article', {
    class: 'category-card',
    children: [
      h('div', {
        class: 'category-card__head',
        children: [
          h('span', {
            class: 'category-card__dot',
            attrs: { style: `background:${CATEGORY_COLORS[id] ?? 'var(--text-muted)'}` },
          }),
          h('div', {
            class: 'category-card__body',
            children: [
              h('div', { class: 'category-card__name', text: meta.label }),
              h('div', {
                class: 'category-card__desc',
                text: `${meta.description} · ${stats?.total ?? 0} Einträge`,
              }),
            ],
          }),
          expand,
          h('span', { class: 'switch', children: [toggle, h('span', { class: 'switch__track' })] }),
        ],
      }),
      sublist,
    ],
  });
}

function renderCustomRules() {
  const list = $('#custom-list');
  list.replaceChildren();

  const rules = state.settings.customRules;
  if (rules.length === 0) {
    list.appendChild(h('li', { class: 'empty', text: 'Noch keine eigenen Regeln.' }));
    return;
  }

  rules.forEach((rule, index) => {
    const remove = h('button', { class: 'btn btn--danger btn--sm', text: 'Entfernen' });
    remove.addEventListener('click', () => act(MSG.CUSTOM_RULE_REMOVE, { index }));

    list.appendChild(
      h('li', {
        class: 'entry',
        children: [
          h('span', {
            class: 'entry__main',
            children: [h('span', { class: 'entry__mono', text: rule.urlFilter })],
          }),
          remove,
        ],
      })
    );
  });
}

// ==================== Filterlisten ====================

function renderLists() {
  const container = $('#lists-container');
  container.replaceChildren();

  for (const preset of state.presets) {
    const toggle = /** @type {HTMLInputElement} */ (
      h('input', { attrs: { type: 'checkbox', 'aria-label': `${preset.name} verwenden` } })
    );
    toggle.checked = preset.enabled;
    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      await act(MSG.PRESET_TOGGLE, { presetId: preset.id, enabled: toggle.checked });
    });

    const update = h('button', { class: 'btn btn--sm', text: 'Aktualisieren' });
    update.addEventListener('click', async () => {
      update.disabled = true;
      update.textContent = 'Lädt …';
      const response = await send(MSG.PRESET_UPDATE, { presetId: preset.id });
      if (response.ok) toast(`${preset.name} aktualisiert.`, 'ok');
      else toast(response.error?.message ?? 'Aktualisierung fehlgeschlagen.', 'error');
      await load();
    });

    const name = h('div', { class: 'list-card__name' });
    name.appendChild(h('span', { text: preset.name }));
    if (preset.recommended)
      name.appendChild(h('span', { class: 'tag tag--ok', text: 'empfohlen' }));
    if (preset.isStale) name.appendChild(h('span', { class: 'tag tag--warn', text: 'veraltet' }));

    const body = h('div', {
      class: 'list-card__body',
      children: [
        name,
        h('p', { class: 'list-card__desc', text: preset.description }),
        h('p', {
          class: 'list-card__meta',
          text: preset.enabled
            ? `${formatCount(preset.ruleCount)} Regeln · zuletzt ${formatRelativeTime(preset.updatedAt)} · ${preset.license}`
            : `ca. ${formatCount(preset.approximateRules)} Einträge · ${preset.license}`,
        }),
      ],
    });

    if (preset.lastError) {
      body.appendChild(h('p', { class: 'list-card__error', text: `Fehler: ${preset.lastError}` }));
    }

    container.appendChild(
      h('article', {
        class: 'list-card',
        children: [
          body,
          h('div', {
            class: 'list-card__actions',
            children: [
              ...(preset.enabled ? [update] : []),
              h('span', {
                class: 'switch',
                children: [toggle, h('span', { class: 'switch__track' })],
              }),
            ],
          }),
        ],
      })
    );
  }

  // Hinweis auf das Regel-Kontingent. Genau das fehlte in v4 — dort scheiterte
  // das Setzen der Regeln stillschweigend, sobald das Limit überschritten war.
  const active = state.presets.filter((preset) => preset.enabled);
  const totalRules = active.reduce((sum, preset) => sum + preset.ruleCount, 0);
  const budget = $('#lists-budget');

  if (active.length === 0) {
    budget.textContent =
      'Die mitgelieferten Filter decken die häufigsten Werbe- und Trackingdienste ab. Zusätzliche Listen erhöhen die Abdeckung.';
    budget.className = 'notice';
  } else {
    budget.textContent = `${active.length} Liste(n) aktiv mit zusammen ${formatCount(totalRules)} Regeln. Chrome begrenzt die Anzahl dynamischer Regeln; überzählige Regeln werden verworfen und im Diagnosebereich ausgewiesen.`;
    budget.className = 'notice';
  }
}

// ==================== Ausnahmen ====================

function renderWhitelist() {
  const list = $('#whitelist-list');
  list.replaceChildren();

  const { whitelist } = state.settings;
  $('#whitelist-count').textContent =
    whitelist.length === 0
      ? 'Noch keine Ausnahmen.'
      : `${whitelist.length} Website(s) freigegeben.`;

  for (const domain of whitelist) {
    const remove = h('button', {
      class: 'btn btn--danger btn--sm',
      text: 'Entfernen',
      attrs: { 'aria-label': `${domain} entfernen` },
    });
    remove.addEventListener('click', () => act(MSG.WHITELIST_REMOVE, { domain }));

    list.appendChild(
      h('li', {
        class: 'entry',
        children: [
          h('span', {
            class: 'entry__main',
            children: [
              h('span', { class: 'entry__title', text: domain }),
              h('span', { class: 'entry__meta', text: 'inklusive aller Subdomains' }),
            ],
          }),
          remove,
        ],
      })
    );
  }
}

// ==================== Ausgeblendete Elemente ====================

function renderElements() {
  const list = $('#elements-list');
  list.replaceChildren();

  const all = state.settings.elementRules;
  const filtered = all.filter((rule) => {
    if (elementFilter === 'global') return !rule.siteOnly;
    if (elementFilter === 'site') return rule.siteOnly;
    return true;
  });

  for (const button of document.querySelectorAll('#element-filters button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === elementFilter));
  }

  if (filtered.length === 0) {
    list.appendChild(
      h('li', {
        class: 'empty',
        text:
          all.length === 0
            ? 'Noch nichts ausgeblendet. Rechtsklick auf ein Element und „Element auf dieser Seite blockieren“ wählen.'
            : 'Keine Einträge in dieser Auswahl.',
      })
    );
    return;
  }

  for (const rule of filtered) {
    // Der Index muss sich auf die vollständige Liste beziehen, nicht auf die
    // gefilterte Ansicht — in v4 löschte der Knopf bei aktivem Filter den
    // falschen Eintrag.
    const index = all.indexOf(rule);

    const remove = h('button', { class: 'btn btn--danger btn--sm', text: 'Entfernen' });
    remove.addEventListener('click', () => act(MSG.ELEMENT_RULE_REMOVE, { index }));

    list.appendChild(
      h('li', {
        class: 'entry',
        children: [
          h('span', {
            class: 'entry__main',
            children: [
              h('span', { class: 'entry__mono', text: rule.selector }),
              h('span', {
                class: 'entry__meta',
                text: `${rule.siteOnly ? rule.domain : 'auf allen Seiten'} · angelegt ${formatRelativeTime(rule.createdAt)}`,
              }),
            ],
          }),
          remove,
        ],
      })
    );
  }
}

// ==================== Statistik ====================

function renderStats() {
  renderRanking($('#top-domains'), state.topDomains, 'domain', 'Noch keine Daten.');
  renderRanking($('#top-sites'), state.topSites, 'hostname', 'Noch keine Daten.');
}

/**
 * Zeichnet eine Rangliste.
 * @param {HTMLElement} list
 * @param {Array<any>} entries
 * @param {string} key
 * @param {string} emptyText
 */
function renderRanking(list, entries, key, emptyText) {
  list.replaceChildren();

  if (!entries || entries.length === 0) {
    list.appendChild(h('li', { class: 'empty', text: emptyText }));
    return;
  }

  entries.forEach((entry, index) => {
    list.appendChild(
      h('li', {
        class: 'entry',
        children: [
          h('span', { class: 'entry__meta', text: `${index + 1}.` }),
          h('span', {
            class: 'entry__main',
            children: [h('span', { class: 'entry__title', text: entry[key] })],
          }),
          h('span', { class: 'tag tag--accent', text: formatCount(entry.count ?? entry.total) }),
        ],
      })
    );
  });
}

// ==================== Diagnose ====================

async function loadDiagnostics() {
  const response = await send(MSG.DIAGNOSTICS_GET);
  if (!response.ok) return;

  const report = response.data;
  const kv = $('#diagnostics-kv');
  kv.replaceChildren();

  const rows = [
    ['Version', report.version],
    [
      'Dynamische Regeln',
      `${formatCount(report.dynamicRuleCount)} von ${formatCount(report.dynamicRuleLimit)}`,
    ],
    ['Ausnahmen', formatCount(report.whitelistCount)],
    ['Eigene Regeln', formatCount(report.customRuleCount)],
    ['Ausgeblendete Elemente', formatCount(report.elementRuleCount)],
    ['Gespeicherte Tage', formatCount(report.statsDays)],
    ['Wartende Ereignisse', formatCount(report.pendingStatsEvents)],
    [
      'Speicher belegt',
      report.storage.percentage < 0
        ? 'nicht ermittelbar'
        : `${formatBytes(report.storage.bytesInUse)} (${report.storage.percentage} %)`,
    ],
    [
      'Trefferzählung',
      report.onRuleMatchedDebugAvailable
        ? 'exakt (Entwicklungsmodus)'
        : 'getaktet über den aktiven Tab',
    ],
  ];

  if (report.rulesError) rows.push(['Fehler beim Lesen der Regeln', report.rulesError]);

  for (const [label, value] of rows) {
    kv.appendChild(h('dt', { text: label }));
    kv.appendChild(h('dd', { text: String(value) }));
  }

  /** @type {HTMLSelectElement} */ ($('#log-level')).value = report.logLevel;
}

// ==================== Aktionen ====================

/**
 * Sendet eine Nachricht und lädt danach neu.
 * @param {string} type
 * @param {object} [payload]
 * @param {string} [successMessage]
 * @returns {Promise<boolean>}
 */
async function act(type, payload = {}, successMessage) {
  const response = await send(type, payload);
  if (!response.ok) {
    toast(response.error?.message ?? 'Die Aktion ist fehlgeschlagen.', 'error');
    await load();
    return false;
  }
  if (successMessage) toast(successMessage, 'ok');
  await load();
  return true;
}

// ---- Kopf und Darstellung ----

$('#master-toggle').addEventListener('change', (event) =>
  act(MSG.SET_MASTER_ENABLED, { enabled: event.target.checked })
);

for (const button of document.querySelectorAll('#mode-picker button')) {
  button.addEventListener('click', () => act(MSG.SET_UI_MODE, { mode: button.dataset.mode }));
}

/**
 * Ändert ein Feld unter `ui` in den Einstellungen.
 *
 * Es gibt bewusst keine eigene Nachricht je Schalter: Die Darstellung ist reine
 * Oberfläche und geht gesammelt über den Import-Pfad, der ohnehin validiert.
 *
 * @param {Partial<{theme: string, showBadge: boolean, reduceMotion: boolean, showNotifications: boolean}>} patch
 */
async function updateUiSettings(patch) {
  const next = { ...state.settings, ui: { ...state.settings.ui, ...patch } };
  const response = await send(MSG.SETTINGS_IMPORT, { json: JSON.stringify({ settings: next }) });
  if (!response.ok) {
    toast(response.error?.message ?? 'Konnte nicht gespeichert werden.', 'error');
    return;
  }
  await load();
}

$('#theme-select').addEventListener('change', (event) =>
  updateUiSettings({ theme: event.target.value })
);
$('#badge-toggle').addEventListener('change', (event) =>
  updateUiSettings({ showBadge: event.target.checked })
);
$('#motion-toggle').addEventListener('change', (event) =>
  updateUiSettings({ reduceMotion: event.target.checked })
);
$('#notify-toggle').addEventListener('change', (event) =>
  updateUiSettings({ showNotifications: event.target.checked })
);

// ---- Filter ----

$('#cosmetic-toggle').addEventListener('change', async (event) => {
  const next = { ...state.settings, cosmeticFiltersEnabled: event.target.checked };
  await send(MSG.SETTINGS_IMPORT, { json: JSON.stringify({ settings: next }) });
  await load();
});

$('#antiadblock-toggle').addEventListener('change', async (event) => {
  const next = { ...state.settings, antiAdblockDefuseEnabled: event.target.checked };
  await send(MSG.SETTINGS_IMPORT, { json: JSON.stringify({ settings: next }) });
  await load();
});

$('#custom-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('#custom-input'));
  const value = input.value.trim();
  if (!value) return;
  const ok = await act(MSG.CUSTOM_RULE_ADD, { urlFilter: value }, 'Regel hinzugefügt.');
  if (ok) input.value = '';
});

// ---- Filterlisten ----

$('#update-all').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Wird aktualisiert …';

  const response = await send(MSG.PRESET_UPDATE_ALL);
  if (response.ok) {
    const { updated, failed } = response.data;
    if (failed.length > 0)
      toast(`${updated.length} aktualisiert, ${failed.length} fehlgeschlagen.`, 'error');
    else if (updated.length > 0) toast(`${updated.length} Liste(n) aktualisiert.`, 'ok');
    else toast('Keine aktive Liste zum Aktualisieren.', 'info');
  } else {
    toast(response.error?.message ?? 'Aktualisierung fehlgeschlagen.', 'error');
  }

  button.disabled = false;
  button.textContent = 'Alle aktiven Listen aktualisieren';
  await load();
});

// ---- Ausnahmen ----

$('#whitelist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('#whitelist-input'));
  const value = input.value.trim();
  if (!value) return;
  const ok = await act(MSG.WHITELIST_ADD, { domain: value }, 'Website freigegeben.');
  if (ok) input.value = '';
});

// ---- Ausgeblendete Elemente ----

for (const button of document.querySelectorAll('#element-filters button')) {
  button.addEventListener('click', () => {
    elementFilter = button.dataset.filter;
    renderElements();
  });
}

$('#clear-elements').addEventListener('click', () => {
  if (!confirmAction('Wirklich alle ausgeblendeten Elemente wieder einblenden?')) return;
  act(MSG.ELEMENT_RULE_CLEAR, {}, 'Alle Einträge entfernt.');
});

// ---- Statistik ----

$('#reset-stats').addEventListener('click', () => {
  if (!confirmAction('Alle Zähler auf null zurücksetzen? Einstellungen bleiben erhalten.')) return;
  act(MSG.STATS_RESET, {}, 'Statistik zurückgesetzt.');
});

// ---- Diagnose ----

$('#run-selftest').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const results = $('#selftest-results');
  button.disabled = true;
  button.textContent = 'Wird geprüft …';
  results.replaceChildren();

  const response = await send(MSG.DIAGNOSTICS_SELFTEST);
  button.disabled = false;
  button.textContent = 'Selbsttest starten';

  if (!response.ok) {
    toast(response.error?.message ?? 'Der Selbsttest konnte nicht ausgeführt werden.', 'error');
    return;
  }

  for (const check of response.data.checks) {
    results.appendChild(
      h('li', {
        class: 'check',
        children: [
          h('span', {
            class: `check__icon check__icon--${check.ok ? 'ok' : 'fail'}`,
            text: check.ok ? '✓' : '!',
            attrs: { 'aria-hidden': 'true' },
          }),
          h('span', {
            children: [
              h('div', { text: `${check.name}${check.ok ? '' : ' — Problem'}` }),
              h('div', { class: 'check__detail', text: check.detail }),
            ],
          }),
        ],
      })
    );
  }

  await loadDiagnostics();
});

$('#log-level').addEventListener('change', (event) =>
  act(MSG.DIAGNOSTICS_SET_LEVEL, { level: event.target.value }, 'Protokollstufe geändert.')
);

$('#export-diagnostics').addEventListener('click', async () => {
  const response = await send(MSG.DIAGNOSTICS_EXPORT);
  if (!response.ok) {
    toast('Der Bericht konnte nicht erstellt werden.', 'error');
    return;
  }
  const date = new Date().toISOString().split('T')[0];
  downloadFile(`pblock-diagnose-${date}.txt`, response.data.text, 'text/plain');
  toast('Bericht heruntergeladen.', 'ok');
});

// ---- Sicherung ----

$('#export-settings').addEventListener('click', async () => {
  const response = await send(MSG.SETTINGS_EXPORT);
  if (!response.ok) {
    toast('Der Export ist fehlgeschlagen.', 'error');
    return;
  }
  const date = new Date().toISOString().split('T')[0];
  downloadFile(`pblock-einstellungen-${date}.json`, response.data.json);
  toast('Einstellungen exportiert.', 'ok');
});

$('#import-settings').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const json = await readFileAsText(file);
    const ok = await act(MSG.SETTINGS_IMPORT, { json }, 'Einstellungen importiert.');
    if (!ok) return;
  } catch (error) {
    toast(
      error instanceof Error ? error.message : 'Die Datei konnte nicht gelesen werden.',
      'error'
    );
  } finally {
    // Zurücksetzen, damit dieselbe Datei erneut gewählt werden kann.
    event.target.value = '';
  }
});

$('#reset-settings').addEventListener('click', () => {
  if (
    !confirmAction(
      'Alle Einstellungen auf den Auslieferungszustand zurücksetzen?\n\nAusnahmen, eigene Regeln und ausgeblendete Elemente gehen dabei verloren.'
    )
  ) {
    return;
  }
  act(MSG.SETTINGS_RESET, {}, 'Einstellungen zurückgesetzt.');
});

// ==================== Start ====================

load().then(() => {
  const page = location.hash.slice(1);
  if (page && document.getElementById(`page-${page}`)) navigate(page);
});
