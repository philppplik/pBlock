/**
 * Popup-Logik.
 *
 * Der Aufbau folgt einem einfachen Muster: Ein `state`-Objekt hält alles,
 * `render()` schreibt es ins DOM, und Ereignisse ändern den Zustand und rendern
 * neu. v4 verteilte dieselbe Arbeit auf `loadState`, `updateUI`, `updateStatsLive`,
 * `renderCategories` und `renderCategoryBreakdown`, die sich teils überschrieben
 * und teils widersprachen.
 */

import { MSG } from '../../core/messages.js';
import { CATEGORY_COLORS } from '../../core/constants.js';
import { formatBytes, formatCount } from '../../core/statistics.js';
import { $, applyTheme, connectLive, h, send, toast } from '../shared/ui-kit.js';

/** @type {any} */
let state = null;

const dom = {
  root: document.body,
  master: /** @type {HTMLInputElement} */ ($('#master-toggle')),
  masterLabel: $('#master-label'),
  today: $('#count-today'),
  week: $('#count-week'),
  total: $('#count-total'),
  bandwidth: $('#count-bandwidth'),
  siteSection: $('.site'),
  siteHost: $('#site-host'),
  siteMeta: $('#site-meta'),
  siteToggle: /** @type {HTMLInputElement} */ ($('#site-toggle')),
  siteToggleLabel: $('#site-toggle-label'),
  levelSection: $('#level-section'),
  levelSlider: /** @type {HTMLInputElement} */ ($('#level-slider')),
  levelName: $('#level-name'),
  levelHint: $('#level-hint'),
  levelStops: /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.level__stop')
  ),
  categoriesSection: $('#categories-section'),
  categoriesList: $('#categories-list'),
  breakdownSection: $('#breakdown-section'),
  breakdownList: $('#breakdown-list'),
  errorBox: $('#error-box'),
  actionPicker: $('#action-picker'),
  actionMode: $('#action-mode'),
  actionOptions: $('#action-options'),
};

/**
 * Zeigt einen Fehler dauerhaft an.
 * @param {string|null} message `null` blendet den Kasten aus.
 */
function showError(message) {
  if (!message) {
    dom.errorBox.hidden = true;
    return;
  }
  dom.errorBox.textContent = message;
  dom.errorBox.hidden = false;
}

/** Lädt den Zustand und zeichnet die Oberfläche. */
async function load() {
  const response = await send(MSG.GET_POPUP_STATE);

  if (!response.ok) {
    showError(response.error?.message ?? 'Der Zustand konnte nicht geladen werden.');
    return;
  }

  showError(null);
  state = response.data;
  applyTheme(state.settings.ui);
  render();
}

/** Zeichnet alles neu. */
function render() {
  if (!state) return;
  const { settings, summary, site, tab } = state;

  // --- Hauptschalter --------------------------------------------------
  dom.master.checked = settings.masterEnabled;
  dom.masterLabel.textContent = settings.masterEnabled ? 'Schutz aktiv' : 'Schutz pausiert';
  dom.root.dataset.disabled = String(!settings.masterEnabled);

  // --- Zähler ----------------------------------------------------------
  dom.today.textContent = formatCount(summary.today);
  dom.week.textContent = formatCount(summary.week);
  dom.total.textContent = formatCount(summary.total);
  dom.bandwidth.textContent = formatBytes(summary.bandwidthBytes);

  renderSite(tab, site);
  renderLevel(settings);
  renderCategories(settings);
  renderBreakdown(summary.categories);

  dom.actionMode.textContent = settings.uiMode === 'simple' ? 'Expertenmodus' : 'Einfacher Modus';
}

/**
 * Zeichnet den Bereich zur aktuellen Seite.
 * @param {any} tab
 * @param {any} site
 */
function renderSite(tab, site) {
  if (!tab.hostname) {
    dom.siteHost.textContent = 'Keine Webseite';
    dom.siteMeta.textContent = 'Auf dieser Seite ist pBlock nicht aktiv.';
    dom.siteToggle.disabled = true;
    dom.siteSection.dataset.paused = 'false';
    return;
  }

  dom.siteToggle.disabled = false;
  dom.siteHost.textContent = tab.hostname;
  // Der Schalter zeigt „Schutz an“ — also das Gegenteil der Whitelist.
  dom.siteToggle.checked = !tab.isWhitelisted;
  dom.siteSection.dataset.paused = String(tab.isWhitelisted);

  if (tab.isWhitelisted) {
    // Wichtig für das Verständnis: Der Nutzer hat vielleicht `example.com`
    // freigegeben und steht jetzt auf `shop.example.com`.
    dom.siteMeta.textContent =
      tab.coveredBy && tab.coveredBy !== tab.hostname
        ? `Pausiert über den Eintrag ${tab.coveredBy}`
        : 'Auf dieser Seite pausiert';
    dom.siteToggleLabel.textContent = 'Schutz auf dieser Seite wieder aktivieren';
    return;
  }

  dom.siteMeta.textContent =
    site.total > 0
      ? `${formatCount(site.today)} heute · ${formatCount(site.total)} insgesamt`
      : 'Noch nichts blockiert';
  dom.siteToggleLabel.textContent = 'Schutz auf dieser Seite pausieren';
}

/**
 * Zeichnet die Schutzstufe.
 * @param {any} settings
 */
function renderLevel(settings) {
  const isSimple = settings.uiMode === 'simple';
  dom.levelSection.hidden = !isSimple;
  if (!isSimple) return;

  const level = settings.protectionLevel;
  dom.levelSlider.value = String(level);
  dom.levelName.textContent = state.levelLabels[level] ?? '–';
  dom.levelHint.textContent = state.levelHints[level] ?? '';

  for (const stop of dom.levelStops) {
    stop.setAttribute('aria-current', String(Number(stop.dataset.level) === level));
  }
}

/**
 * Zeichnet die Kategorieschalter des Expertenmodus.
 * @param {any} settings
 */
function renderCategories(settings) {
  const isExpert = settings.uiMode === 'expert';
  dom.categoriesSection.hidden = !isExpert;
  if (!isExpert) return;

  dom.categoriesList.replaceChildren();

  for (const [id, meta] of Object.entries(state.taxonomy)) {
    const config = settings.categories[id];
    if (!config) continue;

    const count = state.registryStats[id]?.total ?? 0;
    const input = /** @type {HTMLInputElement} */ (
      h('input', { attrs: { type: 'checkbox', id: `cat-${id}`, 'aria-label': meta.label } })
    );
    input.checked = config.enabled;
    input.addEventListener('change', () => setCategory(id, input.checked));

    const item = h('li', {
      class: 'category',
      children: [
        h('span', {
          class: 'category__dot',
          attrs: { style: `background:${CATEGORY_COLORS[id] ?? 'var(--text-muted)'}` },
        }),
        h('span', {
          class: 'category__body',
          children: [
            h('span', { class: 'category__name', text: meta.label }),
            h('span', {
              class: 'category__count',
              text: `${count} Domains und Muster`,
            }),
          ],
        }),
        h('span', {
          class: 'switch',
          children: [input, h('span', { class: 'switch__track' })],
        }),
      ],
    });

    dom.categoriesList.appendChild(item);
  }
}

/**
 * Zeichnet die Verteilung nach Kategorie.
 * @param {Array<{category: string, count: number, percentage: number}>} categories
 */
function renderBreakdown(categories) {
  const withData = categories.filter((entry) => entry.count > 0).slice(0, 5);
  dom.breakdownSection.hidden = withData.length === 0;
  if (withData.length === 0) return;

  dom.breakdownList.replaceChildren();

  for (const entry of withData) {
    const label = state.taxonomy[entry.category]?.label ?? labelForPseudoCategory(entry.category);

    dom.breakdownList.appendChild(
      h('li', {
        class: 'bar',
        children: [
          h('span', { class: 'bar__label', text: label }),
          h('span', {
            class: 'bar__track',
            children: [
              h('span', {
                class: 'bar__fill',
                attrs: {
                  style: `width:${entry.percentage}%;background:${CATEGORY_COLORS[entry.category] ?? 'var(--text-muted)'}`,
                },
              }),
            ],
          }),
          h('span', { class: 'bar__value', text: `${entry.percentage}%` }),
        ],
      })
    );
  }
}

/**
 * Benennt Kategorien, die nicht aus der Taxonomie stammen.
 * @param {string} id
 * @returns {string}
 */
function labelForPseudoCategory(id) {
  const labels = {
    custom: 'Eigene Regeln',
    category: 'Mitgeliefert',
    presets: 'Filterlisten',
    cosmetic: 'Ausgeblendet',
  };
  return labels[id] ?? id;
}

// ==================== Aktionen ====================

/**
 * Führt eine Aktion aus und lädt danach neu.
 * @param {string} type
 * @param {object} [payload]
 * @param {string} [successMessage]
 */
async function act(type, payload = {}, successMessage) {
  const response = await send(type, payload);
  if (!response.ok) {
    toast(response.error?.message ?? 'Die Aktion ist fehlgeschlagen.', 'error');
    // Zustand neu laden, damit die Oberfläche nicht eine Änderung anzeigt,
    // die gar nicht gespeichert wurde.
    await load();
    return false;
  }
  if (successMessage) toast(successMessage, 'ok');
  await load();
  return true;
}

/**
 * @param {string} id
 * @param {boolean} enabled
 */
function setCategory(id, enabled) {
  act(MSG.SET_CATEGORY, { categoryId: id, enabled });
}

/**
 * @param {number} level
 */
function setLevel(level) {
  // Sofortige optische Rückmeldung, bevor die Antwort da ist.
  if (state) {
    dom.levelName.textContent = state.levelLabels[level] ?? '–';
    dom.levelHint.textContent = state.levelHints[level] ?? '';
    for (const stop of dom.levelStops) {
      stop.setAttribute('aria-current', String(Number(stop.dataset.level) === level));
    }
  }
  act(MSG.SET_PROTECTION_LEVEL, { level });
}

// ==================== Ereignisse ====================

dom.master.addEventListener('change', () => {
  act(MSG.SET_MASTER_ENABLED, { enabled: dom.master.checked });
});

dom.siteToggle.addEventListener('change', async () => {
  const ok = await act(MSG.WHITELIST_TOGGLE_ACTIVE_TAB);
  if (!ok) return;
  // Die Seite muss neu geladen werden, damit die geänderte Regel greift —
  // declarativeNetRequest wirkt erst auf neue Anfragen.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id === 'number') {
    await chrome.tabs.reload(tab.id);
    window.close();
  }
});

dom.levelSlider.addEventListener('input', () => {
  const level = Number(dom.levelSlider.value);
  if (state) {
    dom.levelName.textContent = state.levelLabels[level] ?? '–';
    dom.levelHint.textContent = state.levelHints[level] ?? '';
  }
});

dom.levelSlider.addEventListener('change', () => setLevel(Number(dom.levelSlider.value)));

for (const stop of dom.levelStops) {
  stop.addEventListener('click', () => {
    const level = Number(stop.dataset.level);
    dom.levelSlider.value = String(level);
    setLevel(level);
  });
}

dom.actionMode.addEventListener('click', async () => {
  const next = state?.settings.uiMode === 'simple' ? 'expert' : 'simple';
  await act(MSG.SET_UI_MODE, { mode: next });
});

dom.actionPicker.addEventListener('click', async () => {
  const response = await send(MSG.PICKER_ACTIVATE);
  if (!response.ok) {
    toast(response.error?.message ?? 'Auf dieser Seite nicht möglich.', 'error');
    return;
  }
  // Das Popup muss sich schließen, sonst kann man nicht auf die Seite klicken.
  window.close();
});

dom.actionOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// Live-Aktualisierung der Zähler, solange das Popup offen ist.
connectLive((message) => {
  if (message.type !== MSG.PUSH_STATS || !state) return;
  state.summary = message.payload;
  dom.today.textContent = formatCount(state.summary.today);
  dom.week.textContent = formatCount(state.summary.week);
  dom.total.textContent = formatCount(state.summary.total);
  dom.bandwidth.textContent = formatBytes(state.summary.bandwidthBytes);
  renderBreakdown(state.summary.categories);
});

load();
