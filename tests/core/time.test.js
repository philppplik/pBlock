import { describe, expect, test } from 'vitest';
import {
  dayLabel,
  fromDayKey,
  getIsoWeek,
  lastDayKeys,
  toDayKey,
  toWeekKey,
} from '../../src/core/time.js';

describe('toDayKey', () => {
  test('formatiert nach ISO mit führenden Nullen', () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  // Regression: v4 nutzte toDateString() als Storage-Schlüssel. Der ist
  // sprachabhängig ("Fri Sep 11 2026") und damit kein stabiler Schlüssel.
  test('ist unabhängig von der Locale', () => {
    expect(toDayKey(new Date(2026, 8, 11))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Regression: toISOString() hätte abends in MEZ bereits den Folgetag geliefert.
  test('nutzt die lokale Zeitzone, nicht UTC', () => {
    const spaetabends = new Date(2026, 8, 11, 23, 30);
    expect(toDayKey(spaetabends)).toBe('2026-09-11');
  });
});

describe('fromDayKey', () => {
  test('liest gültige Schlüssel', () => {
    const date = fromDayKey('2026-09-11');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(11);
  });

  test.each(['2026-9-1', '20260911', 'unsinn', '', null, '2026-02-31'])(
    'lehnt ungültigen Schlüssel %s ab',
    (key) => {
      expect(fromDayKey(key)).toBeNull();
    }
  );
});

describe('getIsoWeek', () => {
  // Bekannte ISO-Wochen als Stützstellen.
  test.each([
    [new Date(2026, 0, 1), 1], // Do, 1.1.2026 → KW 1
    [new Date(2026, 0, 4), 1], // So, 4.1.2026 → noch KW 1
    [new Date(2026, 0, 5), 2], // Mo, 5.1.2026 → KW 2
    [new Date(2024, 11, 30), 1], // Mo, 30.12.2024 → bereits KW 1 von 2025
    [new Date(2026, 8, 11), 37],
  ])('berechnet für %s die Woche %i', (date, expected) => {
    expect(getIsoWeek(date)).toBe(expected);
  });

  // Regression: v4 rechnete ceil(msSeitJahresbeginn / Woche). Das liefert am
  // 1. Januar die Woche 1, springt aber im Jahresverlauf um bis zu zwei Wochen.
  test('liefert nie mehr als 53', () => {
    for (let day = 0; day < 366; day += 1) {
      const date = new Date(2026, 0, 1 + day);
      const week = getIsoWeek(date);
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(53);
    }
  });
});

describe('toWeekKey', () => {
  test('enthält Jahr und Woche', () => {
    expect(toWeekKey(new Date(2026, 8, 11))).toBe('2026-W37');
  });

  test('ordnet den Jahreswechsel dem ISO-Jahr zu', () => {
    // 30.12.2024 gehört zur KW 1 des Jahres 2025.
    expect(toWeekKey(new Date(2024, 11, 30))).toBe('2025-W01');
  });
});

describe('lastDayKeys', () => {
  test('liefert die gewünschte Anzahl, ältester zuerst', () => {
    const keys = lastDayKeys(3, new Date(2026, 8, 11));
    expect(keys).toEqual(['2026-09-09', '2026-09-10', '2026-09-11']);
  });

  test('funktioniert über Monatsgrenzen hinweg', () => {
    expect(lastDayKeys(2, new Date(2026, 2, 1))).toEqual(['2026-02-28', '2026-03-01']);
  });
});

describe('dayLabel', () => {
  const heute = new Date(2026, 8, 11);

  test('benennt heute und gestern', () => {
    expect(dayLabel('2026-09-11', heute)).toBe('Heute');
    expect(dayLabel('2026-09-10', heute)).toBe('Gestern');
  });

  test('nutzt sonst den Wochentag', () => {
    expect(dayLabel('2026-09-09', heute)).toBe('Mi');
  });

  test('reicht ungültige Schlüssel unverändert durch', () => {
    expect(dayLabel('unsinn', heute)).toBe('unsinn');
  });
});
