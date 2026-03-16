// pBlock - Element Picker (Content Script)
// Enhanced version with preview modal, undo, and pBlock theme

(function() {
  'use strict';

  let isActive = false;
  let overlay = null;
  let highlight = null;
  let tooltip = null;
  let selectedElement = null;
  let previewModal = null;
  let undoToast = null;
  let undoTimeout = null;
  let infoBar = null;

  // ==================== CSS ANIMATIONS ====================

  const PICKER_STYLES = `
    @keyframes pblock-pulse {
      0%, 100% { box-shadow: 0 0 8px rgba(229, 71, 72, 0.4); }
      50% { box-shadow: 0 0 20px rgba(229, 71, 72, 0.7); }
    }
    @keyframes pblock-slideIn {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes pblock-fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes pblock-modalIn {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes pblock-toastIn {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes pblock-toastOut {
      from { opacity: 1; transform: translateX(-50%) translateY(0); }
      to { opacity: 0; transform: translateX(-50%) translateY(20px); }
    }
    @keyframes pblock-progress {
      from { width: 100%; }
      to { width: 0%; }
    }
  `;

  // ==================== OVERLAY CREATION ====================

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'pblock-picker-styles';
    style.textContent = PICKER_STYLES;
    document.head.appendChild(style);
  }

  function removeStyles() {
    document.getElementById('pblock-picker-styles')?.remove();
  }

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

    // Highlight box with pBlock red theme
    highlight = document.createElement('div');
    highlight.id = 'adblocker-picker-highlight';
    highlight.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      border: 2px solid #E54748;
      background: rgba(229, 71, 72, 0.08);
      transition: all 0.15s ease;
      display: none;
      animation: pblock-pulse 1.5s infinite;
      border-radius: 3px;
    `;

    // Enhanced tooltip
    tooltip = document.createElement('div');
    tooltip.id = 'adblocker-picker-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      background: #1C1C1C;
      color: #e6edf3;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      border: 1px solid #2a2a2a;
      max-width: 450px;
      word-break: break-all;
      display: none;
    `;

    // Info bar
    infoBar = document.createElement('div');
    infoBar.id = 'adblocker-picker-infobar';
    infoBar.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #1C1C1C;
      color: #e6edf3;
      padding: 14px 24px;
      border-radius: 12px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      border: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      gap: 20px;
      animation: pblock-slideIn 0.3s ease;
    `;
    infoBar.innerHTML = `
      <span style="display: flex; align-items: center; gap: 8px;">
        <span style="
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #E54748;
          box-shadow: 0 0 8px rgba(229, 71, 72, 0.6);
        "></span>
        <span style="color: #E54748; font-weight: 600;">Element Picker</span>
      </span>
      <span style="color: #8b949e;">Klicke auf ein Element um es zu blockieren</span>
      <span style="color: #6e7681; font-size: 11px;">Mausrad = Eltern-Element</span>
      <button id="adblocker-picker-cancel" style="
        background: #2a2a2a;
        border: 1px solid #3a3a3a;
        color: #8b949e;
        padding: 6px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        transition: all 0.15s ease;
      ">Abbrechen (ESC)</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(highlight);
    document.body.appendChild(tooltip);
    document.body.appendChild(infoBar);

    // Cancel button
    const cancelBtn = document.getElementById('adblocker-picker-cancel');
    cancelBtn.addEventListener('click', deactivate);
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = '#3a3a3a';
      cancelBtn.style.color = '#e6edf3';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = '#2a2a2a';
      cancelBtn.style.color = '#8b949e';
    });
  }

  function removeOverlay() {
    overlay?.remove();
    highlight?.remove();
    tooltip?.remove();
    document.getElementById('adblocker-picker-infobar')?.remove();
    overlay = null;
    highlight = null;
    tooltip = null;
    infoBar = null;
  }

  // Hide picker UI elements temporarily so elementFromPoint can see through
  function hidePickerUI() {
    if (overlay) overlay.style.display = 'none';
    if (highlight) highlight.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    if (infoBar) infoBar.style.display = 'none';
  }

  // Show picker UI elements again
  function showPickerUI() {
    if (overlay) overlay.style.display = '';
    if (infoBar) infoBar.style.display = '';
    // highlight and tooltip visibility managed by highlightElement()
  }

  // Get the real element under cursor by temporarily hiding picker UI
  function getElementUnderCursor(clientX, clientY) {
    hidePickerUI();
    const el = document.elementFromPoint(clientX, clientY);
    showPickerUI();
    return el;
  }

  // ==================== CSS SELECTOR GENERATION ====================

  function generateSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    const selectors = [];

    // Try ID first (but not dynamic-looking IDs)
    if (el.id && !/\d{3,}/.test(el.id)) {
      selectors.push('#' + CSS.escape(el.id));
    }

    // Try class names
    if (el.classList.length > 0) {
      const classes = Array.from(el.classList)
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
      if (current.id && !/\d{3,}/.test(current.id)) {
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

  // ==================== ELEMENT INFO ====================

  function getElementInfo(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const classes = el.classList.length > 0 ? '.' + Array.from(el.classList).slice(0, 3).join('.') : '';
    const selector = generateSelector(el);
    const rect = el.getBoundingClientRect();

    // Build breadcrumb path
    const breadcrumb = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < 5) {
      let crumb = current.tagName.toLowerCase();
      if (current.id) crumb += '#' + current.id;
      else if (current.classList.length > 0) crumb += '.' + current.classList[0];
      breadcrumb.unshift(crumb);
      current = current.parentElement;
      depth++;
    }

    return {
      tag,
      id,
      classes,
      selector,
      rect,
      breadcrumb: breadcrumb.join(' > '),
      dimensions: `${Math.round(rect.width)}x${Math.round(rect.height)}`
    };
  }

  // ==================== HIGHLIGHT & TOOLTIP ====================

  function highlightElement(el) {
    const info = getElementInfo(el);
    if (!info.rect.width || !info.rect.height) return;

    highlight.style.display = 'block';
    highlight.style.left = info.rect.left + 'px';
    highlight.style.top = info.rect.top + 'px';
    highlight.style.width = info.rect.width + 'px';
    highlight.style.height = info.rect.height + 'px';

    // Enhanced tooltip with more info
    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <span style="color: #E54748; font-weight: 600; font-size: 13px;">${info.tag}</span>
        ${info.id ? `<span style="color: #58A6FF; font-size: 11px;">${info.id}</span>` : ''}
        <span style="color: #6e7681; font-size: 10px; margin-left: auto;">${info.dimensions}</span>
      </div>
      ${info.classes ? `<div style="color: #8b949e; font-size: 11px; margin-bottom: 4px;">${info.classes.slice(0, 60)}</div>` : ''}
      <div style="color: #6e7681; font-size: 10px; border-top: 1px solid #2a2a2a; padding-top: 6px; margin-top: 4px; word-break: break-all;">
        ${info.breadcrumb}
      </div>
    `;

    // Position tooltip
    let tooltipTop = info.rect.bottom + 10;
    let tooltipLeft = info.rect.left;

    if (tooltipTop + 100 > window.innerHeight) {
      tooltipTop = info.rect.top - 10;
      tooltip.style.transform = 'translateY(-100%)';
    } else {
      tooltip.style.transform = 'none';
    }

    if (tooltipLeft + 450 > window.innerWidth) {
      tooltipLeft = window.innerWidth - 470;
    }
    if (tooltipLeft < 10) tooltipLeft = 10;

    tooltip.style.top = tooltipTop + 'px';
    tooltip.style.left = tooltipLeft + 'px';

    selectedElement = el;
  }

  // ==================== PREVIEW MODAL ====================

  function showPreviewModal(el) {
    const info = getElementInfo(el);
    if (!info.selector) return;

    // Count matching elements
    let matchCount = 0;
    try {
      matchCount = document.querySelectorAll(info.selector).length;
    } catch (e) {
      matchCount = 1;
    }

    previewModal = document.createElement('div');
    previewModal.id = 'pblock-preview-modal';
    previewModal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pblock-fadeIn 0.2s ease;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #1C1C1C;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 28px;
      width: 480px;
      max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      animation: pblock-modalIn 0.25s ease;
    `;

    modalContent.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
        <div style="
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(238, 118, 124, 0.2) 0%, rgba(159, 1, 50, 0.2) 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E54748" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </div>
        <div>
          <div style="font-size: 18px; font-weight: 600; color: #e6edf3;">Element blockieren</div>
          <div style="font-size: 12px; color: #8b949e; margin-top: 2px;">${matchCount} Element${matchCount !== 1 ? 'e' : ''} auf dieser Seite</div>
        </div>
      </div>

      <!-- Element Info -->
      <div style="background: #161616; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 20px;">
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 13px;">
          <span style="color: #6e7681;">Tag:</span>
          <span style="color: #e6edf3; font-family: monospace;">${info.tag}</span>
          ${info.id ? `
            <span style="color: #6e7681;">ID:</span>
            <span style="color: #58A6FF; font-family: monospace;">${info.id}</span>
          ` : ''}
          ${info.classes ? `
            <span style="color: #6e7681;">Klassen:</span>
            <span style="color: #3fb950; font-family: monospace; font-size: 12px;">${info.classes.slice(0, 50)}</span>
          ` : ''}
          <span style="color: #6e7681;">Größe:</span>
          <span style="color: #e6edf3;">${info.dimensions}px</span>
        </div>
      </div>

      <!-- Selector Input -->
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; font-weight: 500; color: #e6edf3; margin-bottom: 8px;">
          CSS-Selektor
        </label>
        <input
          type="text"
          id="pblock-selector-input"
          value="${info.selector}"
          style="
            width: 100%;
            padding: 10px 14px;
            background: #161616;
            border: 1px solid #2a2a2a;
            border-radius: 8px;
            color: #e6edf3;
            font-size: 13px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            box-sizing: border-box;
            transition: border-color 0.15s ease;
          "
        />
        <div style="font-size: 11px; color: #6e7681; margin-top: 6px;">
          Bearbeite den Selektor falls nötig
        </div>
      </div>

      <!-- Site-only Toggle -->
      <label style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        background: #161616;
        border: 1px solid #2a2a2a;
        border-radius: 10px;
        cursor: pointer;
        margin-bottom: 24px;
        transition: border-color 0.15s ease;
      " id="pblock-site-only-label">
        <div style="position: relative; width: 44px; height: 24px; flex-shrink: 0;">
          <input type="checkbox" id="pblock-site-only" style="opacity: 0; width: 0; height: 0; position: absolute;">
          <span id="pblock-site-only-slider" style="
            position: absolute;
            cursor: pointer;
            inset: 0;
            background: #2a2a2a;
            border-radius: 12px;
            transition: 0.25s ease;
          "></span>
          <span id="pblock-site-only-knob" style="
            position: absolute;
            content: '';
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background: #8b949e;
            border-radius: 50%;
            transition: 0.25s ease;
          "></span>
        </div>
        <div>
          <div style="font-size: 13px; font-weight: 500; color: #e6edf3;">Nur auf dieser Seite</div>
          <div style="font-size: 11px; color: #6e7681; margin-top: 2px;">${window.location.hostname}</div>
        </div>
      </label>

      <!-- Action Buttons -->
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="pblock-cancel-btn" style="
          padding: 10px 20px;
          background: transparent;
          border: 1px solid #2a2a2a;
          border-radius: 8px;
          color: #8b949e;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s ease;
        ">Abbrechen</button>
        <button id="pblock-confirm-btn" style="
          padding: 10px 24px;
          background: linear-gradient(135deg, #EE767C 0%, #E54748 50%, #9F0132 100%);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s ease;
          box-shadow: 0 2px 8px rgba(229, 71, 72, 0.3);
        ">Blockieren</button>
      </div>
    `;

    previewModal.appendChild(modalContent);
    document.body.appendChild(previewModal);

    // Style the selector input on focus
    const selectorInput = document.getElementById('pblock-selector-input');
    selectorInput.addEventListener('focus', () => {
      selectorInput.style.borderColor = '#E54748';
      selectorInput.style.boxShadow = '0 0 0 3px rgba(229, 71, 72, 0.15)';
    });
    selectorInput.addEventListener('blur', () => {
      selectorInput.style.borderColor = '#2a2a2a';
      selectorInput.style.boxShadow = 'none';
    });

    // Site-only toggle functionality
    const siteOnlyCheckbox = document.getElementById('pblock-site-only');
    const siteOnlySlider = document.getElementById('pblock-site-only-slider');
    const siteOnlyKnob = document.getElementById('pblock-site-only-knob');

    function updateSiteOnlyToggle() {
      if (siteOnlyCheckbox.checked) {
        siteOnlySlider.style.background = 'linear-gradient(135deg, #EE767C 0%, #E54748 50%, #9F0132 100%)';
        siteOnlyKnob.style.transform = 'translateX(20px)';
        siteOnlyKnob.style.background = '#fff';
      } else {
        siteOnlySlider.style.background = '#2a2a2a';
        siteOnlyKnob.style.transform = 'translateX(0)';
        siteOnlyKnob.style.background = '#8b949e';
      }
    }

    siteOnlyCheckbox.addEventListener('change', updateSiteOnlyToggle);

    // Label click toggles checkbox
    document.getElementById('pblock-site-only-label').addEventListener('click', (e) => {
      if (e.target !== siteOnlyCheckbox) {
        siteOnlyCheckbox.checked = !siteOnlyCheckbox.checked;
        updateSiteOnlyToggle();
      }
    });

    // Button hover effects
    const cancelBtn = document.getElementById('pblock-cancel-btn');
    const confirmBtn = document.getElementById('pblock-confirm-btn');

    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = '#2a2a2a';
      cancelBtn.style.color = '#e6edf3';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'transparent';
      cancelBtn.style.color = '#8b949e';
    });
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.opacity = '0.9';
    });
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.opacity = '1';
    });

    // Button actions
    cancelBtn.addEventListener('click', closePreviewModal);
    confirmBtn.addEventListener('click', () => {
      const finalSelector = selectorInput.value.trim();
      const siteOnly = siteOnlyCheckbox.checked;
      if (finalSelector) {
        confirmBlock(finalSelector, siteOnly);
      }
    });

    // Focus selector input
    setTimeout(() => selectorInput.select(), 100);

    // Close on overlay click
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) {
        closePreviewModal();
      }
    });
  }

  function closePreviewModal() {
    if (previewModal) {
      previewModal.remove();
      previewModal = null;
    }
  }

  // ==================== CONFIRM BLOCK ====================

  function confirmBlock(selector, siteOnly) {
    // Send to background for saving
    chrome.runtime.sendMessage({
      type: 'addElementRule',
      selector: selector,
      domain: window.location.hostname,
      siteOnly: siteOnly
    });

    // Close modal and show undo toast
    closePreviewModal();
    showUndoToast(selector);

    // Hide the element immediately
    if (selectedElement) {
      selectedElement.style.setProperty('display', 'none', 'important');
      selectedElement.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  // ==================== UNDO TOAST ====================

  function showUndoToast(selector) {
    // Remove existing toast
    if (undoToast) {
      undoToast.remove();
    }
    if (undoTimeout) {
      clearTimeout(undoTimeout);
    }

    undoToast = document.createElement('div');
    undoToast.id = 'pblock-undo-toast';
    undoToast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #1C1C1C;
      color: #e6edf3;
      padding: 0;
      border-radius: 12px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      border: 1px solid #2a2a2a;
      overflow: hidden;
      min-width: 320px;
      animation: pblock-toastIn 0.3s ease;
    `;

    undoToast.innerHTML = `
      <div style="padding: 14px 20px; display: flex; align-items: center; gap: 16px;">
        <span style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #3fb950; font-size: 16px;">&#10003;</span>
          <span>Element blockiert</span>
        </span>
        <button id="pblock-undo-btn" style="
          background: transparent;
          border: 1px solid #3a3a3a;
          color: #58A6FF;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          transition: all 0.15s ease;
          white-space: nowrap;
        ">Rückgängig</button>
      </div>
      <div id="pblock-undo-progress" style="
        height: 3px;
        background: linear-gradient(90deg, #3fb950, #E54748);
        animation: pblock-progress 5s linear forwards;
      "></div>
    `;

    document.body.appendChild(undoToast);

    // Undo button handler
    document.getElementById('pblock-undo-btn').addEventListener('click', () => {
      performUndo();
    });

    // Auto-dismiss after 5 seconds
    undoTimeout = setTimeout(() => {
      dismissUndoToast();
    }, 5000);
  }

  function performUndo() {
    chrome.runtime.sendMessage({ type: 'undoElementBlock' }, (response) => {
      if (response?.success && selectedElement) {
        // Restore the element
        selectedElement.style.removeProperty('display');
        selectedElement.style.removeProperty('visibility');
      }
      dismissUndoToast();
    });
  }

  function dismissUndoToast() {
    if (undoTimeout) {
      clearTimeout(undoTimeout);
      undoTimeout = null;
    }
    if (undoToast) {
      undoToast.style.animation = 'pblock-toastOut 0.3s ease forwards';
      setTimeout(() => {
        undoToast?.remove();
        undoToast = null;
      }, 300);
    }
    deactivate();
  }

  // ==================== EVENT HANDLERS ====================

  function onMouseMove(e) {
    if (!isActive) return;

    // Temporarily hide picker UI to see the real element underneath
    const el = getElementUnderCursor(e.clientX, e.clientY);
    if (el && !el.id?.startsWith('adblocker-picker-') && !el.id?.startsWith('pblock-')) {
      highlightElement(el);
    }
  }

  function onClick(e) {
    if (!isActive) return;
    e.preventDefault();
    e.stopPropagation();

    // Temporarily hide picker UI to see the real element underneath
    const el = getElementUnderCursor(e.clientX, e.clientY);
    if (el && !el.id?.startsWith('adblocker-picker-') && !el.id?.startsWith('pblock-')) {
      showPreviewModal(el);
    }
  }

  function onWheel(e) {
    if (!isActive || !selectedElement) return;
    e.preventDefault();

    // Navigate to parent element
    if (e.deltaY < 0 && selectedElement.parentElement && selectedElement.parentElement !== document.body) {
      selectedElement = selectedElement.parentElement;
      highlightElement(selectedElement);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (previewModal) {
        closePreviewModal();
      } else {
        deactivate();
      }
    }
  }

  // ==================== ACTIVATE / DEACTIVATE ====================

  function activate() {
    if (isActive) return;
    isActive = true;
    injectStyles();
    createOverlay();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyDown, true);
  }

  function deactivate() {
    isActive = false;
    removeOverlay();
    removeStyles();
    closePreviewModal();

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('wheel', onWheel, { capture: true });
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // ==================== MESSAGE LISTENER ====================

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
