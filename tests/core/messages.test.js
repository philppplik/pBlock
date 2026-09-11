import { describe, expect, test } from 'vitest';
import { LIVE_PORT_NAME, MSG, fail, ok } from '../../src/core/messages.js';

describe('Antwortformat', () => {
  test('ok verpackt Daten', () => {
    expect(ok({ wert: 1 })).toEqual({ ok: true, data: { wert: 1 } });
  });

  test('ok ohne Argument liefert null als Daten', () => {
    expect(ok()).toEqual({ ok: true, data: null });
  });

  test('fail trägt Meldung und Code', () => {
    expect(fail('Regel ungültig', 'RULE_INVALID')).toEqual({
      ok: false,
      error: { message: 'Regel ungültig', code: 'RULE_INVALID' },
    });
  });

  test('fail nutzt einen Standardcode', () => {
    expect(fail('irgendwas').error.code).toBe('UNKNOWN');
  });

  // Der Unterschied ist entscheidend: Die Oberfläche darf einen Fehler nicht
  // mit "keine Daten" verwechseln. In v4 kam bei Fehlern schlicht `undefined`
  // zurück und die UI zeigte stumm eine Null an.
  test('Erfolg und Fehler sind eindeutig unterscheidbar', () => {
    expect(ok(0).ok).toBe(true);
    expect(fail('x').ok).toBe(false);
    expect(ok(0).error).toBeUndefined();
    expect(fail('x').data).toBeUndefined();
  });
});

describe('Nachrichtentypen', () => {
  test('sind eindeutig', () => {
    const werte = Object.values(MSG);
    expect(new Set(werte).size).toBe(werte.length);
  });

  test('folgen dem Schema bereich:aktion', () => {
    for (const wert of Object.values(MSG)) {
      expect(wert, wert).toMatch(/^[a-zA-Z]+:[a-zA-Z]+$/);
    }
  });

  test('MSG ist eingefroren', () => {
    expect(Object.isFrozen(MSG)).toBe(true);
  });

  test('der Port-Name ist gesetzt', () => {
    expect(LIVE_PORT_NAME).toBe('pblock-live');
  });
});
