// pBlock - Popup Script (v4.0.0 Friendly Bird)

let currentLevel = 'simple';
let state = null;
let statsPort = null;

const SLIDER_LEVELS = {
  0:   { label: 'Aus' },
  25:  { label: 'Minimal' },
  50:  { label: 'Standard' },
  75:  { label: 'Hoch' },
  100: { label: 'Maximum' }
};

// Kategorie Farben
const CATEGORY_COLORS = {
  ads:        '#E54748',
  analytics:  '#58A6FF',
  social:     '#BC8CFF',
  annoyances: '#F0883E',
  oem:        '#8B949E',
  custom:     '#3FB950',
  presets:    '#79C0FF'
};

const CATEGORY_LABELS = {
  ads:        'Werbung',
  analytics:  'Tracker',
  social:     'Social',
  annoyances: 'Nerviges',
  oem:        'OEM',
  custom:     'Custom',
  presets:    'Listen'
};

// DOM Elements
const masterToggle = document.getElementById('masterToggle');
const todayCount = document.getElementById('todayCount');
const weekCount = document.getElementById('weekCount');
const totalCount = document.getElementById('totalCount');
const activeRules = document.getElementById('activeRules');
const bandwidthSaved = document.getElementById('bandwidthSaved');
const categoryBreakdown = document.getElementById('categoryBreakdown');
const liveIndicator = document.getElementById('liveIndicator');
const simpleModeSection = document.getElementById('simpleModeSection');
const expertModeSection = document.getElementById('expertModeSection');
const elementRulesSection = document.getElementById('elementRulesSection');
const elementRulesCount = document.getElementById('elementRulesCount');
const manageElementRules = document.getElementById('manageElementRules');
const levelBtns = document.querySelectorAll('.level-btn');
const openOptions = document.getElementById('openOptions');
const protectionSlider = document.getElementById('protectionSlider');
const sliderLabel = document.getElementById('sliderLabel');
const sliderSteps = document.querySelectorAll('.slider-step');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  renderCategories();
  setupEventListeners();
  connectStatsPort();
});

// Port-based live stats updates
function connectStatsPort() {
  statsPort = chrome.runtime.connect({ name: 'stats' });
  statsPort.onMessage.addListener((message) => {
    if (message.type === 'statsUpdate' && message.stats) {
      updateStatsLive(message.stats);
    }
  });
  statsPort.onDisconnect.addListener(() => {
    // Reconnect after delay if popup still open
    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        connectStatsPort();
      }
    }, 1000);
  });
}

// Live update stats without full reload
function updateStatsLive(stats) {
  // Animate counters
  animateCounter(todayCount, stats.today);
  animateCounter(weekCount, stats.week);
  animateCounter(totalCount, stats.total);

  // Update bandwidth
  if (bandwidthSaved) {
    bandwidthSaved.textContent = stats.bandwidthFormatted;
  }

  // Update category breakdown
  renderCategoryBreakdown(stats.categoryBreakdown);

  // Pulse live indicator
  if (liveIndicator) {
    liveIndicator.classList.add('pulse');
    setTimeout(() => liveIndicator.classList.remove('pulse'), 500);
  }
}

// Animate counter change
function animateCounter(element, newValue) {
  if (!element) return;
  const currentValue = parseInt(element.textContent.replace(/[^\d]/g, '')) || 0;
  if (currentValue !== newValue) {
    element.textContent = formatNumber(newValue);
    element.classList.add('counter-up');
    setTimeout(() => element.classList.remove('counter-up'), 300);
  }
}

// Render category breakdown bars
function renderCategoryBreakdown(breakdown) {
  if (!categoryBreakdown || !breakdown) return;

  const totalBlocks = Object.values(breakdown).reduce((sum, cat) => sum + cat.today, 0);

  categoryBreakdown.innerHTML = Object.entries(breakdown)
    .filter(([_, stats]) => stats.today > 0)
    .sort((a, b) => b[1].today - a[1].today)
    .map(([cat, stats]) => {
      const pct = totalBlocks > 0 ? Math.round((stats.today / totalBlocks) * 100) : 0;
      const color = CATEGORY_COLORS[cat] || '#8B949E';
      const label = CATEGORY_LABELS[cat] || cat;
      return `
        <div class="category-bar-row">
          <span class="category-bar-label">${label}</span>
          <div class="category-bar-track">
            <div class="category-bar-fill" style="width: ${pct}%; background: ${color};"></div>
          </div>
          <span class="category-bar-value">${pct}%</span>
        </div>
      `;
    }).join('');
}

async function loadState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getFullState' }, (response) => {
      if (response) {
        state = response;
        currentLevel = state.settings.filterLevel || 'simple';
        updateUI();
      }
      resolve();
    });
  });
}

function updateUI() {
  if (!state) return;

  // Master toggle
  masterToggle.checked = state.settings.masterEnabled;

  // Stats
  todayCount.textContent = formatNumber(state.statistics.today);
  weekCount.textContent = formatNumber(state.statistics.week);
  totalCount.textContent = formatNumber(state.statistics.total);

  // Bandwidth saved
  if (bandwidthSaved && state.statistics.bandwidthFormatted) {
    bandwidthSaved.textContent = state.statistics.bandwidthFormatted;
  }

  // Category breakdown
  if (state.statistics.categoryBreakdown) {
    renderCategoryBreakdown(state.statistics.categoryBreakdown);
  }

  // Active rules count
  activeRules.textContent = `${state.activeRuleCount} Regeln aktiv`;

  // Level buttons
  levelBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === currentLevel);
  });

  // Show/hide mode sections
  const isSimple = currentLevel === 'simple';
  simpleModeSection.style.display = isSimple ? 'block' : 'none';
  expertModeSection.style.display = isSimple ? 'none' : 'block';
  elementRulesSection.style.display = isSimple ? 'none' : 'flex';

  // Update element rules count
  if (elementRulesCount && state.elementRulesCount !== undefined) {
    elementRulesCount.textContent = state.elementRulesCount;
  }

  // Update slider position from stored value
  if (isSimple && state.settings.sliderValue !== undefined) {
    protectionSlider.value = state.settings.sliderValue;
    updateSliderUI(state.settings.sliderValue);
  }

  // Disabled state
  simpleModeSection.classList.toggle('disabled-overlay', !state.settings.masterEnabled);
  expertModeSection.classList.toggle('disabled-overlay', !state.settings.masterEnabled);
}

function updateSliderUI(value) {
  const level = SLIDER_LEVELS[value];
  if (level) {
    sliderLabel.textContent = level.label;
  }

  sliderSteps.forEach(step => {
    step.classList.toggle('active', parseInt(step.dataset.value) === value);
  });
}

function renderCategories() {
  if (!state) return;

  expertModeSection.innerHTML = '';

  for (const [catKey, catConfig] of Object.entries(state.settings.categories)) {
    const stats = state.ruleStats[catKey] || { total: 0, subcategories: {} };
    const item = createCategoryElement(catKey, catConfig, stats);
    expertModeSection.appendChild(item);
  }
}

function createCategoryElement(catKey, catConfig, stats) {
  const div = document.createElement('div');
  div.className = 'category-wrapper';

  // Main category item
  const item = document.createElement('div');
  item.className = 'category-item';
  item.innerHTML = `
    <div class="category-info">
      <span class="category-icon"><iconify-icon icon="${catConfig.icon}" width="20" height="20"></iconify-icon></span>
      <div>
        <div class="category-name">${catConfig.label}</div>
        <div class="category-count">${stats.total} Domains</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <button class="expand-btn" data-cat="${catKey}">▼</button>
      <label class="toggle">
        <input type="checkbox" data-category="${catKey}" ${catConfig.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>
  `;
  div.appendChild(item);

  // Subcategories
  if (catConfig.subcategories) {
    const subList = document.createElement('div');
    subList.className = 'subcategory-list';
    subList.id = `sub-${catKey}`;

    for (const [subKey, subConfig] of Object.entries(catConfig.subcategories)) {
      const count = stats.subcategories[subKey] || 0;
      const subItem = document.createElement('div');
      subItem.className = 'subcategory-item';
      subItem.innerHTML = `
        <div>
          <div class="subcategory-name">${subConfig.label}</div>
          <div class="category-count">${count} Domains</div>
        </div>
        <div class="subcategory-toggle">
          <label class="toggle">
            <input type="checkbox" data-category="${catKey}" data-subcategory="${subKey}" ${subConfig.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;
      subList.appendChild(subItem);
    }

    div.appendChild(subList);
  }

  return div;
}

function setupEventListeners() {
  // Master toggle
  masterToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      type: 'toggle',
      enabled: masterToggle.checked
    }, () => {
      loadState();
    });
  });

  // Level switcher
  levelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentLevel = btn.dataset.level;
      chrome.runtime.sendMessage({
        type: 'setFilterLevel',
        level: currentLevel
      }, () => {
        renderCategories();
        updateUI();
        setupCategoryListeners();
      });
    });
  });

  // Slider
  protectionSlider.addEventListener('input', () => {
    const value = parseInt(protectionSlider.value);
    updateSliderUI(value);
  });

  protectionSlider.addEventListener('change', () => {
    const value = parseInt(protectionSlider.value);
    chrome.runtime.sendMessage({
      type: 'applySliderPreset',
      value: value
    }, () => {
      loadState();
    });
  });

  // Slider step labels as clickable shortcuts
  sliderSteps.forEach(step => {
    step.addEventListener('click', () => {
      const value = parseInt(step.dataset.value);
      protectionSlider.value = value;
      updateSliderUI(value);
      chrome.runtime.sendMessage({
        type: 'applySliderPreset',
        value: value
      }, () => {
        loadState();
      });
    });
  });

  // Category listeners
  setupCategoryListeners();

  // Open options
  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Manage element rules - open options page to elements section
  if (manageElementRules) {
    manageElementRules.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html#elements') });
    });
  }

  // Open privacy page
  const openPrivacy = document.getElementById('openPrivacy');
  if (openPrivacy) {
    openPrivacy.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') });
    });
  }
}

function setupCategoryListeners() {
  // Category toggles
  expertModeSection.querySelectorAll('input[data-category]').forEach(input => {
    input.addEventListener('change', () => {
      const catId = input.dataset.category;
      const subId = input.dataset.subcategory;

      if (subId) {
        chrome.runtime.sendMessage({
          type: 'toggleSubcategory',
          categoryId: catId,
          subcategoryId: subId,
          enabled: input.checked
        }, () => {
          loadState();
        });
      } else {
        chrome.runtime.sendMessage({
          type: 'toggleCategory',
          categoryId: catId,
          enabled: input.checked
        }, () => {
          loadState();
        });
      }
    });
  });

  // Expand buttons
  expertModeSection.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const catKey = btn.dataset.cat;
      const subList = document.getElementById(`sub-${catKey}`);
      if (subList) {
        subList.classList.toggle('show');
        btn.classList.toggle('rotated');
      }
    });
  });
}

// Helpers
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString('de-DE');
}
