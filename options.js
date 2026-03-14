// pBlock - Options Page Script

let state = null;
let currentPage = 'overview';
let allDomains = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  updateSidebarVisibility();
  setupNavigation();
  setupOverview();
  setupFilter();
  setupPresets();
  setupWhitelist();
  setupStatistics();
  setupExpert();
  setupBackup();
  handleHashNavigation();
});

// ==================== STATE ====================

async function loadState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getFullState' }, (response) => {
      if (response) {
        state = response;
        buildDomainList();
      }
      resolve();
    });
  });
}

function buildDomainList() {
  allDomains = [];
  if (!state?.ruleStats) return;

  for (const [catKey, catData] of Object.entries(state.ruleStats)) {
    const catLabel = state.settings.categories[catKey]?.label || catKey;
    for (const [subKey, count] of Object.entries(catData.subcategories)) {
      const subLabel = state.settings.categories[catKey]?.subcategories[subKey]?.label || subKey;
      // Add placeholder entries for each subcategory
      allDomains.push({
        domain: `${subLabel} (${count} Regeln)`,
        category: catLabel,
        subcategory: subKey,
        categoryKey: catKey,
        enabled: state.settings.categories[catKey]?.enabled && state.settings.categories[catKey]?.subcategories[subKey]?.enabled
      });
    }
  }
}

// ==================== NAVIGATION ====================

function updateSidebarVisibility() {
  const isExpert = state?.settings?.filterLevel === 'expert';
  document.querySelectorAll('.nav-expert').forEach(item => {
    item.classList.toggle('hidden', !isExpert);
  });
  const divider = document.getElementById('expert-nav-divider');
  if (divider) divider.classList.toggle('hidden', !isExpert);

  // If currently on an expert-only page and in simple mode, redirect to overview
  const expertPages = ['filter', 'presets', 'whitelist', 'expert', 'backup'];
  if (!isExpert && expertPages.includes(currentPage)) {
    navigateTo('overview');
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `page-${page}`);
  });
  refreshCurrentPage();
}

function handleHashNavigation() {
  const hash = window.location.hash.slice(1);
  if (hash) navigateTo(hash);
}

function refreshCurrentPage() {
  switch (currentPage) {
    case 'overview': updateOverview(); break;
    case 'statistics': updateStatistics(); break;
    case 'whitelist': updateWhitelist(); break;
    case 'expert': updateExpert(); break;
  }
}

// ==================== OVERVIEW ====================

function setupOverview() {
  document.querySelectorAll('.level-card').forEach(card => {
    card.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'setFilterLevel', level: card.dataset.level }, async () => {
        await loadState();
        updateSidebarVisibility();
        updateOverview();
        updateFilter();
      });
    });
  });
  updateOverview();
}

function updateOverview() {
  if (!state) return;
  document.querySelectorAll('.level-card').forEach(card => {
    card.classList.toggle('active', card.dataset.level === state.settings.filterLevel);
  });
  document.getElementById('ov-today').textContent = fmt(state.statistics.today);
  document.getElementById('ov-week').textContent = fmt(state.statistics.week);
  document.getElementById('ov-total').textContent = fmt(state.statistics.total);
  updateChart();
}

function updateChart() {
  chrome.runtime.sendMessage({ type: 'getWeeklyHistory' }, (history) => {
    if (!history) return;
    const chart = document.getElementById('ov-chart');
    chart.innerHTML = '';
    const max = Math.max(...history.map(h => h.count), 1);
    history.forEach(day => {
      const w = document.createElement('div');
      w.className = 'chart-bar-wrapper';
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      bar.style.height = `${(day.count / max) * 100}%`;
      bar.title = `${day.label}: ${day.count}`;
      const label = document.createElement('div');
      label.className = 'chart-label';
      label.textContent = day.label;
      w.appendChild(bar);
      w.appendChild(label);
      chart.appendChild(w);
    });
  });
}

// ==================== FILTER ====================

function setupFilter() { updateFilter(); }

function updateFilter() {
  if (!state) return;
  const container = document.getElementById('filter-categories');
  container.innerHTML = '';
  for (const [catKey, catConfig] of Object.entries(state.settings.categories)) {
    const stats = state.ruleStats[catKey] || { total: 0, subcategories: {} };
    container.appendChild(createFilterCard(catKey, catConfig, stats));
  }
}

function createFilterCard(catKey, catConfig, stats) {
  const card = document.createElement('div');
  card.className = 'filter-category-card';
  card.innerHTML = `
    <div class="filter-category-header">
      <div class="info">
        <span class="icon"><iconify-icon icon="${catConfig.icon}" width="24" height="24"></iconify-icon></span>
        <div>
          <div class="name">${catConfig.label}</div>
          <div class="count">${stats.total} Regeln</div>
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" data-category="${catKey}" ${catConfig.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>
    <div class="filter-subcategories">
      ${Object.entries(catConfig.subcategories).map(([subKey, subConfig]) => `
        <div class="filter-sub-item">
          <div class="info">
            <div class="name">${subConfig.label}</div>
            <div class="desc">${subConfig.description}</div>
          </div>
          <span class="count">${stats.subcategories[subKey] || 0}</span>
          <label class="toggle" style="margin-left: 12px;">
            <input type="checkbox" data-category="${catKey}" data-subcategory="${subKey}" ${subConfig.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `).join('')}
    </div>
  `;

  card.querySelector(`input[data-category="${catKey}"]:not([data-subcategory])`)?.addEventListener('change', (e) => {
    chrome.runtime.sendMessage({ type: 'toggleCategory', categoryId: catKey, enabled: e.target.checked }, async () => {
      await loadState();
    });
  });

  card.querySelectorAll('input[data-subcategory]').forEach(input => {
    input.addEventListener('change', (e) => {
      chrome.runtime.sendMessage({
        type: 'toggleSubcategory',
        categoryId: catKey,
        subcategoryId: e.target.dataset.subcategory,
        enabled: e.target.checked
      }, async () => { await loadState(); });
    });
  });

  return card;
}

// ==================== PRESETS ====================

function setupPresets() {
  chrome.runtime.sendMessage({ type: 'getPresets' }, (presets) => {
    if (!presets) return;
    const container = document.getElementById('presets-list');
    container.innerHTML = '';

    for (const [id, preset] of Object.entries(presets)) {
      const card = document.createElement('div');
      card.className = 'preset-card';
      const lastUpdate = preset.lastUpdate ? new Date(preset.lastUpdate).toLocaleDateString('de-DE') : 'Nie';
      card.innerHTML = `
        <div class="preset-info">
          <h3>${preset.name}</h3>
          <p>${preset.description}</p>
          <div class="meta">${preset.ruleCount} Regeln • Letztes Update: ${lastUpdate}</div>
        </div>
        <div class="preset-actions">
          <button class="btn btn-sm" data-update="${id}">Aktualisieren</button>
          <label class="toggle">
            <input type="checkbox" data-preset="${id}" ${preset.enabled ? 'checked' : ''}>
            <span class="slider">
              <iconify-icon class="toggle-icon" icon="mdi:check" width="10" height="10"></iconify-icon>
            </span>
          </label>
        </div>
      `;
      container.appendChild(card);

      card.querySelector(`input[data-preset="${id}"]`)?.addEventListener('change', (e) => {
        chrome.runtime.sendMessage({ type: 'togglePreset', presetId: id, enabled: e.target.checked });
      });

      card.querySelector(`button[data-update="${id}"]`)?.addEventListener('click', (e) => {
        e.target.textContent = 'Lädt...';
        e.target.disabled = true;
        chrome.runtime.sendMessage({ type: 'updatePreset', presetId: id }, (response) => {
          if (response?.success) {
            e.target.textContent = `${response.count} Regeln`;
          } else {
            e.target.textContent = 'Fehler';
          }
          setTimeout(() => {
            e.target.textContent = 'Aktualisieren';
            e.target.disabled = false;
          }, 2000);
        });
      });
    }
  });
}

// ==================== WHITELIST ====================

function setupWhitelist() {
  document.getElementById('whitelist-add').addEventListener('click', addWhitelist);
  document.getElementById('whitelist-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addWhitelist(); });
  document.getElementById('whitelist-current').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const domain = new URL(tabs[0].url).hostname;
          chrome.runtime.sendMessage({ type: 'addToWhitelist', domain }, async () => {
            await loadState();
            updateWhitelist();
          });
        } catch {}
      }
    });
  });
  updateWhitelist();
}

function addWhitelist() {
  const input = document.getElementById('whitelist-input');
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  chrome.runtime.sendMessage({ type: 'addToWhitelist', domain }, async () => {
    input.value = '';
    await loadState();
    updateWhitelist();
  });
}

function updateWhitelist() {
  if (!state) return;
  const list = document.getElementById('whitelist-list');
  const whitelist = state.settings.whitelist || [];
  if (whitelist.length === 0) {
    list.innerHTML = '<div class="whitelist-empty">Keine Whitelist-Einträge</div>';
    return;
  }
  list.innerHTML = whitelist.map(d => `
    <div class="list-item">
      <span>${d}</span>
      <button class="btn btn-sm btn-danger" data-domain="${d}">Entfernen</button>
    </div>
  `).join('');
  list.querySelectorAll('button[data-domain]').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'removeFromWhitelist', domain: btn.dataset.domain }, async () => {
        await loadState();
        updateWhitelist();
      });
    });
  });
}

// ==================== STATISTICS ====================

function setupStatistics() {
  document.getElementById('reset-stats').addEventListener('click', () => {
    if (confirm('Alle Statistiken zurücksetzen?')) {
      chrome.runtime.sendMessage({ type: 'resetStatistics' }, async () => {
        await loadState();
        updateStatistics();
      });
    }
  });
  updateStatistics();
}

function updateStatistics() {
  if (!state) return;
  document.getElementById('st-today').textContent = fmt(state.statistics.today);
  document.getElementById('st-week').textContent = fmt(state.statistics.week);
  document.getElementById('st-total').textContent = fmt(state.statistics.total);

  chrome.runtime.sendMessage({ type: 'getTopDomains', limit: 10 }, (top) => {
    const container = document.getElementById('top-domains');
    if (!top || top.length === 0) {
      container.innerHTML = '<div class="whitelist-empty">Noch keine Daten</div>';
      return;
    }
    container.innerHTML = top.map((item, i) => `
      <div class="list-item">
        <span><strong>${i + 1}.</strong> ${item.domain}</span>
        <span class="tag tag-accent">${fmt(item.count)}</span>
      </div>
    `).join('');
  });
}

// ==================== EXPERT ====================

function setupExpert() {
  document.getElementById('domain-search').addEventListener('input', filterDomains);
  updateExpert();
}

function updateExpert() {
  if (!state) return;

  // Stats
  let totalRules = 0;
  for (const cat of Object.values(state.ruleStats)) {
    totalRules += cat.total;
  }
  document.getElementById('ex-total').textContent = totalRules;
  document.getElementById('ex-active').textContent = state.activeRuleCount;
  document.getElementById('ex-custom').textContent = state.settings.customRules?.length || 0;
  document.getElementById('ex-whitelist').textContent = state.settings.whitelist?.length || 0;

  renderDomainTable(allDomains);
}

function renderDomainTable(domains) {
  const tbody = document.getElementById('domain-table-body');
  tbody.innerHTML = domains.map(d => `
    <tr>
      <td>
        <label class="toggle toggle-sm">
          <input type="checkbox" ${d.enabled ? 'checked' : ''} data-cat="${d.categoryKey}" data-sub="${d.subcategory}">
          <span class="slider">
            <iconify-icon class="toggle-icon" icon="mdi:check" width="10" height="10"></iconify-icon>
          </span>
        </label>
      </td>
      <td style="font-family: var(--font-mono); font-size: 12px;">${d.domain}</td>
      <td><span class="tag">${d.category}</span></td>
      <td><span class="tag tag-accent">${d.subcategory}</span></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', (e) => {
      chrome.runtime.sendMessage({
        type: 'toggleSubcategory',
        categoryId: e.target.dataset.cat,
        subcategoryId: e.target.dataset.sub,
        enabled: e.target.checked
      }, async () => { await loadState(); });
    });
  });
}

function filterDomains() {
  const query = document.getElementById('domain-search').value.toLowerCase();
  const filtered = allDomains.filter(d =>
    d.domain.toLowerCase().includes(query) ||
    d.category.toLowerCase().includes(query) ||
    d.subcategory.toLowerCase().includes(query)
  );
  renderDomainTable(filtered);
}

// ==================== BACKUP ====================

function setupBackup() {
  document.getElementById('export-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'exportSettings' }, (response) => {
      if (response?.data) {
        const blob = new Blob([response.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `adblocker-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  });

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      chrome.runtime.sendMessage({ type: 'importSettings', data: event.target.result }, async (response) => {
        if (response?.success) {
          await loadState();
          refreshCurrentPage();
          alert('Einstellungen erfolgreich importiert!');
        } else {
          alert('Fehler beim Importieren.');
        }
      });
    };
    reader.readAsText(file);
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Alle Einstellungen auf Standard zurücksetzen?')) {
      chrome.runtime.sendMessage({ type: 'resetSettings' }, async () => {
        await loadState();
        refreshCurrentPage();
        alert('Einstellungen zurückgesetzt.');
      });
    }
  });
}

// ==================== HELPERS ====================

function fmt(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString('de-DE');
}
