/**
 * Einrichtungsassistent.
 *
 * v4 speicherte die Auswahl des Nutzers am Ende über drei einzelne Nachrichten
 * und einen direkten Storage-Zugriff — ohne zu prüfen, ob davon irgendetwas
 * angekommen war. Danach wurde das Fenster geschlossen. Schlug etwas fehl,
 * startete der Assistent beim nächsten Öffnen einfach wieder.
 *
 * Hier geht alles in einer Nachricht raus, und der Assistent schließt sich erst,
 * wenn sie bestätigt wurde.
 */

import { MSG } from '../../core/messages.js';
import { $, send, toast } from '../shared/ui-kit.js';

const TOTAL_STEPS = 3;
let currentStep = 1;

const dom = {
  indicator: $('#step-indicator'),
  back: /** @type {HTMLButtonElement} */ ($('#back')),
  next: /** @type {HTMLButtonElement} */ ($('#next')),
  expertMode: /** @type {HTMLInputElement} */ ($('#expert-mode')),
};

/**
 * Zeigt einen Schritt an.
 * @param {number} step
 * @param {boolean} [moveFocus=true] Ob der Fokus auf die Überschrift wandern soll.
 *   Beim ersten Aufbau der Seite bewusst `false`: Ein Fokusrahmen, den niemand
 *   durch eine Eingabe ausgelöst hat, wirkt wie ein Darstellungsfehler.
 */
function showStep(step, moveFocus = true) {
  currentStep = Math.min(Math.max(step, 1), TOTAL_STEPS);

  for (const section of document.querySelectorAll('.step')) {
    section.hidden = Number(section.dataset.step) !== currentStep;
  }

  dom.indicator.textContent = `Schritt ${currentStep} von ${TOTAL_STEPS}`;
  dom.back.hidden = currentStep === 1;
  dom.next.textContent = currentStep === TOTAL_STEPS ? 'Fertig' : 'Weiter';

  // Fokus auf die Überschrift des neuen Schritts, damit Bildschirmleser den
  // Wechsel mitbekommen.
  if (!moveFocus) return;
  const heading = document.querySelector(`.step[data-step="${currentStep}"] h1`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

/**
 * Liest die gewählte Schutzstufe.
 * @returns {number}
 */
function selectedLevel() {
  const checked = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="level"]:checked')
  );
  return checked ? Number(checked.value) : 50;
}

/** Speichert die Auswahl und schließt den Assistenten. */
async function finish() {
  dom.next.disabled = true;
  dom.next.textContent = 'Wird gespeichert …';

  const response = await send(MSG.ONBOARDING_COMPLETE, {
    protectionLevel: selectedLevel(),
    uiMode: dom.expertMode.checked ? 'expert' : 'simple',
  });

  if (!response.ok) {
    dom.next.disabled = false;
    dom.next.textContent = 'Erneut versuchen';
    toast(
      response.error?.message ?? 'Die Einstellungen konnten nicht gespeichert werden.',
      'error'
    );
    return;
  }

  // Direkt in die Einstellungen, statt den Nutzer auf einer leeren Seite
  // zurückzulassen.
  await chrome.runtime.openOptionsPage();
  window.close();
}

dom.next.addEventListener('click', () => {
  if (currentStep < TOTAL_STEPS) showStep(currentStep + 1);
  else finish();
});

dom.back.addEventListener('click', () => showStep(currentStep - 1));

// Pfeiltasten zum Blättern.
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowRight' && currentStep < TOTAL_STEPS) showStep(currentStep + 1);
  if (event.key === 'ArrowLeft' && currentStep > 1) showStep(currentStep - 1);
});

showStep(1, false);
