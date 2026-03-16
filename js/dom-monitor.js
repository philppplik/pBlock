// pBlock - DOM Monitor
// Enhanced MutationObserver with debouncing and feature extraction
// Adapted from @cliqz/adblocker DOMMonitor patterns

(function() {
  'use strict';

  const LOG_PREFIX = '[pBlock DOM Monitor]';

  // ==================== CONFIGURATION ====================

  const CONFIG = {
    DEBOUNCE_WAIT: 25,        // ms to wait before processing
    DEBOUNCE_MAX_WAIT: 1000,  // max ms before forced processing
    NODE_THRESHOLD: 512,      // process immediately if more nodes pending
    IGNORED_TAGS: new Set(['br', 'head', 'link', 'meta', 'script', 'style', 's', 'noscript']),
    PBLOCK_ELEMENT_IDS: /^adblocker-|^pblock-/
  };

  // ==================== DEBOUNCE UTILITY ====================

  function debounce(fn, { waitFor, maxWait }) {
    let delayedTimer = null;
    let maxWaitTimer = null;

    const clear = () => {
      clearTimeout(delayedTimer);
      clearTimeout(maxWaitTimer);
      delayedTimer = null;
      maxWaitTimer = null;
    };

    const run = () => {
      clear();
      fn();
    };

    return {
      trigger: () => {
        if (maxWait > 0 && maxWaitTimer === null) {
          maxWaitTimer = setTimeout(run, maxWait);
        }
        clearTimeout(delayedTimer);
        delayedTimer = setTimeout(run, waitFor);
      },
      cancel: clear,
      run
    };
  }

  // ==================== FEATURE EXTRACTION ====================

  function isElement(node) {
    return node.nodeType === 1; // Node.ELEMENT_NODE
  }

  function extractFeaturesFromDOM(roots) {
    const classes = new Set();
    const hrefs = new Set();
    const ids = new Set();
    const seenElements = new Set();

    for (const root of roots) {
      // Query all elements with id, class, or href
      const elements = [
        root,
        ...root.querySelectorAll('[id]:not(html):not(body),[class]:not(html):not(body),[href]:not(html):not(body)')
      ];

      for (const element of elements) {
        // Skip duplicates
        if (seenElements.has(element)) continue;
        seenElements.add(element);

        // Skip ignored tags
        if (CONFIG.IGNORED_TAGS.has(element.nodeName.toLowerCase())) continue;

        // Skip pBlock's own elements
        if (element.id && CONFIG.PBLOCK_ELEMENT_IDS.test(element.id)) continue;

        // Extract ID
        const id = element.getAttribute('id');
        if (typeof id === 'string' && id.length > 0) {
          ids.add(id);
        }

        // Extract classes
        const classList = element.classList;
        for (const cls of classList) {
          classes.add(cls);
        }

        // Extract hrefs
        const href = element.getAttribute('href');
        if (typeof href === 'string' && href.length > 0) {
          hrefs.add(href);
        }
      }
    }

    return {
      classes: Array.from(classes),
      hrefs: Array.from(hrefs),
      ids: Array.from(ids)
    };
  }

  function getElementsFromMutations(mutations) {
    const elements = [];

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (isElement(mutation.target)) {
          elements.push(mutation.target);
        }
      } else if (mutation.type === 'childList') {
        for (const addedNode of mutation.addedNodes) {
          if (isElement(addedNode)) {
            // Skip pBlock's own elements
            if (addedNode.id && CONFIG.PBLOCK_ELEMENT_IDS.test(addedNode.id)) continue;
            elements.push(addedNode);
          }
        }
      }
    }

    return elements;
  }

  // ==================== DOM MONITOR CLASS ====================

  class DOMMonitor {
    constructor(callback) {
      this.callback = callback;
      this.observer = null;
      this.knownIds = new Set();
      this.knownHrefs = new Set();
      this.knownClasses = new Set();
      this.pendingNodes = new Set();
      this.debouncedHandler = null;
    }

    /**
     * Start monitoring DOM mutations
     * @param {Window} window - The window object to monitor
     */
    start(window) {
      if (this.observer !== null) return; // Already running
      if (typeof window.MutationObserver === 'undefined') return;

      const pendingNodes = this.pendingNodes;

      // Create debounced handler
      this.debouncedHandler = debounce(
        () => {
          this.handleUpdatedNodes(Array.from(pendingNodes));
          pendingNodes.clear();
        },
        {
          waitFor: CONFIG.DEBOUNCE_WAIT,
          maxWait: CONFIG.DEBOUNCE_MAX_WAIT
        }
      );

      // Create MutationObserver
      this.observer = new window.MutationObserver((mutations) => {
        const newElements = getElementsFromMutations(mutations);

        // Add to pending set
        for (const el of newElements) {
          pendingNodes.add(el);
        }

        // Check threshold - process immediately if too many pending
        if (pendingNodes.size > CONFIG.NODE_THRESHOLD) {
          console.log(`${LOG_PREFIX} Threshold reached (${pendingNodes.size} nodes), processing immediately`);
          this.debouncedHandler.run();
        } else {
          this.debouncedHandler.trigger();
        }
      });

      // Start observing
      this.observer.observe(window.document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'id', 'href'],
        childList: true,
        subtree: true
      });

      console.log(`${LOG_PREFIX} Started monitoring DOM`);
    }

    /**
     * Stop monitoring DOM mutations
     */
    stop() {
      if (this.observer !== null) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.debouncedHandler) {
        this.debouncedHandler.cancel();
        this.debouncedHandler = null;
      }
      this.pendingNodes.clear();
      console.log(`${LOG_PREFIX} Stopped monitoring DOM`);
    }

    /**
     * Perform initial query of all DOM elements
     * @param {Window} window - The window object
     */
    queryAll(window) {
      const roots = [window.document.documentElement];
      this.handleUpdatedNodes(roots);
      console.log(`${LOG_PREFIX} Initial DOM query complete`);
    }

    /**
     * Process updated nodes and extract new features
     * @param {Element[]} elements - Elements to process
     */
    handleUpdatedNodes(elements) {
      if (elements.length === 0) return;

      // Filter out ignored elements
      const filteredElements = elements.filter(
        (el) => !CONFIG.IGNORED_TAGS.has(el.nodeName.toLowerCase())
      );

      if (filteredElements.length === 0) return;

      // Extract features from elements
      const features = extractFeaturesFromDOM(filteredElements);

      // Check for new features
      const newFeatures = this.handleNewFeatures(features);

      // Notify callback with elements for extended CSS processing
      if (this.callback) {
        this.callback({
          type: 'elements',
          elements: filteredElements
        });

        // Also notify about new features if any
        if (newFeatures) {
          this.callback({
            type: 'features',
            ...features
          });
        }
      }
    }

    /**
     * Check for new features and update known sets
     * @param {Object} features - {ids, classes, hrefs}
     * @returns {boolean} - True if there are new features
     */
    handleNewFeatures({ ids, classes, hrefs }) {
      const newIds = [];
      const newClasses = [];
      const newHrefs = [];

      for (const id of ids) {
        if (!this.knownIds.has(id)) {
          newIds.push(id);
          this.knownIds.add(id);
        }
      }

      for (const cls of classes) {
        if (!this.knownClasses.has(cls)) {
          newClasses.push(cls);
          this.knownClasses.add(cls);
        }
      }

      for (const href of hrefs) {
        if (!this.knownHrefs.has(href)) {
          newHrefs.push(href);
          this.knownHrefs.add(href);
        }
      }

      if (newIds.length > 0 || newClasses.length > 0 || newHrefs.length > 0) {
        console.log(`${LOG_PREFIX} New features found:`, {
          ids: newIds.length,
          classes: newClasses.length,
          hrefs: newHrefs.length
        });
        return true;
      }

      return false;
    }

    /**
     * Reset known features (e.g., on navigation)
     */
    reset() {
      this.knownIds.clear();
      this.knownHrefs.clear();
      this.knownClasses.clear();
      this.pendingNodes.clear();
      console.log(`${LOG_PREFIX} Features reset`);
    }
  }

  // ==================== EXPORT ====================

  // Export for use in cosmetic-injector.js
  window.PBlockDOMMonitor = {
    DOMMonitor,
    extractFeaturesFromDOM,
    CONFIG
  };

  console.log(`${LOG_PREFIX} Module loaded`);
})();
