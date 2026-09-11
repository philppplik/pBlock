/**
 * Beobachtet das DOM auf nachträglich eingefügte Elemente.
 *
 * ## Was gegenüber v4 anders ist
 *
 * v4s DOM-Monitor sammelte bei jeder Mutation sämtliche `id`-, `class`- und
 * `href`-Werte des Teilbaums ein und legte sie in drei wachsenden `Set`s ab, um
 * „neue Merkmale“ zu erkennen. Verwendet wurde dieses Ergebnis nirgends — die
 * Selektoren waren statisch. Auf einer Seite mit Endlos-Scroll wuchsen die Sets
 * unbegrenzt, und bei jeder Mutation lief ein `querySelectorAll('[id],[class],[href]')`
 * über den gesamten neuen Teilbaum.
 *
 * Diese Fassung macht nur noch das, was tatsächlich gebraucht wird: neue Elemente
 * melden, entprellt und mit Obergrenze.
 */

/** Standardwerte der Entprellung. */
export const MONITOR_DEFAULTS = Object.freeze({
  /** Ruhezeit, bevor gesammelte Knoten verarbeitet werden. */
  debounceMs: 25,
  /** Spätestens nach dieser Zeit wird trotzdem verarbeitet. */
  maxWaitMs: 500,
  /** Ab so vielen wartenden Knoten sofort verarbeiten. */
  flushThreshold: 256,
  /** Obergrenze für die Warteschlange, damit sie nicht unbegrenzt wächst. */
  maxQueue: 2_000,
});

/** Elemente, die niemals Werbung sind — spart Arbeit bei jeder Mutation. */
const IGNORED_TAGS = new Set(['BR', 'HEAD', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'STYLE']);

/**
 * Erzeugt einen DOM-Monitor.
 *
 * @param {(elements: Element[]) => void} onElements Rückruf für neue Elemente.
 * @param {Partial<typeof MONITOR_DEFAULTS>} [options]
 * @returns {{start: (root: Node) => void, stop: () => void, isRunning: () => boolean}}
 */
export function createDomMonitor(onElements, options = {}) {
  const config = { ...MONITOR_DEFAULTS, ...options };

  /** @type {MutationObserver|null} */
  let observer = null;
  /** @type {Set<Element>} */
  const queue = new Set();
  /** @type {ReturnType<typeof setTimeout>|null} */
  let debounceTimer = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let maxWaitTimer = null;

  function clearTimers() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
  }

  function flush() {
    clearTimers();
    if (queue.size === 0) return;
    const elements = [...queue];
    queue.clear();
    try {
      onElements(elements);
    } catch {
      // Ein Fehler im Rückruf darf den Monitor nicht abwürgen — sonst bleibt die
      // Seite für den Rest ihrer Lebensdauer unbeobachtet.
    }
  }

  function schedule() {
    if (queue.size >= config.flushThreshold) {
      flush();
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, config.debounceMs);
    if (!maxWaitTimer) maxWaitTimer = setTimeout(flush, config.maxWaitMs);
  }

  return {
    /**
     * Startet die Beobachtung.
     * @param {Node} root
     */
    start(root) {
      if (observer || !root || typeof MutationObserver === 'undefined') return;

      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            const target = /** @type {Element} */ (mutation.target);
            if (target.nodeType === 1) queue.add(target);
            continue;
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const element = /** @type {Element} */ (node);
            if (IGNORED_TAGS.has(element.tagName)) continue;
            queue.add(element);
            if (queue.size > config.maxQueue) break;
          }
        }
        schedule();
      });

      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        // Nur die Attribute beobachten, die für Selektoren zählen. Ohne den
        // Filter meldet jede Style- und ARIA-Änderung eine Mutation — auf
        // animationslastigen Seiten sind das Tausende pro Sekunde.
        attributeFilter: ['class', 'id'],
      });
    },

    stop() {
      observer?.disconnect();
      observer = null;
      clearTimers();
      queue.clear();
    },

    isRunning() {
      return observer !== null;
    },
  };
}
