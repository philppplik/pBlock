// pBlock - Element Picker (Content Script)
// Injected on demand to pick elements on the page

(function() {
  'use strict';

  let isActive = false;
  let overlay = null;
  let highlight = null;
  let tooltip = null;
  let selectedElement = null;

  // Create overlay elements
  function createOverlay() {
    // Full-page overlay
    overlay = document.createElement('div');
    overlay.id = 'adblocker-picker-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      cursor: crosshair;
      background: transparent;
    `;

    // Highlight box
    highlight = document.createElement('div');
    highlight.id = 'adblocker-picker-highlight';
    highlight.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      border: 2px solid #00d4ff;
      background: rgba(0, 212, 255, 0.1);
      transition: all 0.1s ease;
      display: none;
    `;

    // Tooltip
    tooltip = document.createElement('div');
    tooltip.id = 'adblocker-picker-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      background: #161b22;
      color: #e6edf3;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 400px;
      word-break: break-all;
      display: none;
    `;

    // Info bar
    const infoBar = document.createElement('div');
    infoBar.id = 'adblocker-picker-infobar';
    infoBar.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #161b22;
      color: #e6edf3;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 16px;
    `;
    infoBar.innerHTML = `
      <span style="color: #00d4ff; font-weight: 600;">Element Picker</span>
      <span>Klicke auf ein Element um es zu blockieren</span>
      <button id="adblocker-picker-cancel" style="
        background: #30363d;
        border: none;
        color: #8b949e;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
      ">Abbrechen (ESC)</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(highlight);
    document.body.appendChild(tooltip);
    document.body.appendChild(infoBar);

    // Cancel button
    document.getElementById('adblocker-picker-cancel').addEventListener('click', deactivate);
  }

  // Remove overlay elements
  function removeOverlay() {
    overlay?.remove();
    highlight?.remove();
    tooltip?.remove();
    document.getElementById('adblocker-picker-infobar')?.remove();
    overlay = null;
    highlight = null;
    tooltip = null;
  }

  // Generate CSS selector for element
  function generateSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    const selectors = [];

    // Try ID first
    if (el.id && !/\d/.test(el.id)) {
      selectors.push('#' + CSS.escape(el.id));
    }

    // Try class names
    if (el.classList.length > 0) {
      const classes = Array.from(el.classList)
        .filter(c => !/^(ad|ad-|ad_|banner|promo|sponsor)/i.test(c) || true)
        .slice(0, 3)
        .map(c => '.' + CSS.escape(c))
        .join('');
      if (classes) selectors.push(classes);
    }

    // Try data attributes
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        if (/ad|banner|promo|sponsor/i.test(attr.name + attr.value)) {
          selectors.push(`[${attr.name}="${attr.value}"]`);
        }
      }
    }

    // Build path-based selector as fallback
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }

    if (path.length > 0) {
      selectors.push(path.join(' > '));
    }

    return selectors[0] || null;
  }

  // Get element info
  function getElementInfo(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const classes = el.classList.length > 0 ? '.' + Array.from(el.classList).join('.') : '';
    const selector = generateSelector(el);
    const rect = el.getBoundingClientRect();

    return { tag, id, classes, selector, rect };
  }

  // Highlight element
  function highlightElement(el) {
    const info = getElementInfo(el);
    if (!info.rect.width) return;

    highlight.style.display = 'block';
    highlight.style.left = info.rect.left + 'px';
    highlight.style.top = info.rect.top + 'px';
    highlight.style.width = info.rect.width + 'px';
    highlight.style.height = info.rect.height + 'px';

    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div style="color: #00d4ff; font-weight: 600; margin-bottom: 4px;">${info.tag}${info.id}${info.classes.split('.').slice(0, 2).join('.')}</div>
      <div style="color: #8b949e; font-size: 11px;">${info.selector || 'Kein Selektor'}</div>
    `;

    // Position tooltip
    let tooltipTop = info.rect.bottom + 8;
    let tooltipLeft = info.rect.left;

    if (tooltipTop + 80 > window.innerHeight) {
      tooltipTop = info.rect.top - 8;
      tooltip.style.transform = 'translateY(-100%)';
    } else {
      tooltip.style.transform = 'none';
    }

    if (tooltipLeft + 400 > window.innerWidth) {
      tooltipLeft = window.innerWidth - 420;
    }

    tooltip.style.top = tooltipTop + 'px';
    tooltip.style.left = tooltipLeft + 'px';

    selectedElement = el;
  }

  // Handle mouse move
  function onMouseMove(e) {
    if (!isActive) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && !el.id?.startsWith('adblocker-picker-')) {
      highlightElement(el);
    }
  }

  // Handle click
  function onClick(e) {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && !el.id?.startsWith('adblocker-picker-')) {
      const info = getElementInfo(el);
      if (info.selector) {
        // Send to background for adding as custom rule
        chrome.runtime.sendMessage({
          type: 'addElementRule',
          selector: info.selector,
          domain: window.location.hostname
        });

        // Show confirmation
        showConfirmation(info.selector);
      }
    }
  }

  // Show confirmation toast
  function showConfirmation(selector) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #238636;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    toast.textContent = `✓ Element blockiert: ${selector}`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
      deactivate();
    }, 2000);
  }

  // Handle ESC key
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      deactivate();
    }
  }

  // Activate picker
  function activate() {
    if (isActive) return;
    isActive = true;
    createOverlay();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // Deactivate picker
  function deactivate() {
    isActive = false;
    removeOverlay();

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'activatePicker') {
      activate();
      sendResponse({ success: true });
    } else if (message.type === 'deactivatePicker') {
      deactivate();
      sendResponse({ success: true });
    }
  });
})();
