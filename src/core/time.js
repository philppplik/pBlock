/**
 * Zeit- und Datumshilfen.
 *
 * v4 nutzte `new Date().toDateString()` als Storage-Schlüssel (sprach- und
 * zeitzonenabhängig) und eine Wochenzahl aus `ceil(msSeitJahresbeginn / Woche)`,
 * die zum Jahreswechsel springt und nie mit der ISO-Woche übereinstimmt.
 * Beides ist hier korrigiert und testbar isoliert.
 */

/**
 * Stabiler Tagesschlüssel im Format `YYYY-MM-DD` in lokaler Zeitzone.
 *
 * Bewusst nicht `toISOString()`: das rechnet nach UTC um und würde für Nutzer
 * östlich/westlich von Greenwich abends bzw. morgens den falschen Tag liefern.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} z. B. `2026-09-11`
 */
export function toDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parst einen Tagesschlüssel zurück in ein Date (lokale Mitternacht).
 * @param {string} key Format `YYYY-MM-DD`
 * @returns {Date|null} `null`, wenn der Schlüssel ungültig ist.
 */
export function fromDayKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  // Rückprüfung fängt Werte wie 2026-02-31 ab, die JS sonst stillschweigend weiterrollt.
  return toDayKey(date) === key ? date : null;
}

/**
 * ISO-8601-Kalenderwoche.
 *
 * Regel: Die Woche beginnt am Montag; Woche 1 ist die Woche, die den
 * ersten Donnerstag des Jahres enthält.
 *
 * @param {Date} [date=new Date()]
 * @returns {number} 1–53
 */
export function getIsoWeek(date = new Date()) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Auf den Donnerstag derselben ISO-Woche schieben.
  const dayOfWeek = (target.getDay() + 6) % 7; // Mo=0 … So=6
  target.setDate(target.getDate() - dayOfWeek + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayOfWeek = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayOfWeek + 3);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return 1 + Math.round((target - firstThursday) / msPerWeek);
}

/**
 * Eindeutiger Wochenschlüssel inklusive ISO-Jahr, z. B. `2026-W37`.
 *
 * Das ISO-Jahr kann vom Kalenderjahr abweichen: Der 1. Januar 2027 liegt
 * beispielsweise in ISO-Woche 53 des Jahres 2026.
 *
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function toWeekKey(date = new Date()) {
  const week = getIsoWeek(date);
  const month = date.getMonth();
  let isoYear = date.getFullYear();
  if (month === 11 && week === 1) isoYear += 1;
  else if (month === 0 && week >= 52) isoYear -= 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Liefert die Tagesschlüssel der letzten `count` Tage, ältester zuerst.
 * @param {number} count
 * @param {Date} [today=new Date()]
 * @returns {string[]}
 */
export function lastDayKeys(count, today = new Date()) {
  const keys = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    keys.push(toDayKey(date));
  }
  return keys;
}

/**
 * Kurzlabel für Diagramme, lokalisiert auf Deutsch.
 * @param {string} dayKey
 * @param {Date} [today=new Date()]
 * @returns {string}
 */
export function dayLabel(dayKey, today = new Date()) {
  const date = fromDayKey(dayKey);
  if (!date) return dayKey;
  const todayKey = toDayKey(today);
  const yesterdayKey = toDayKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  );
  if (dayKey === todayKey) return 'Heute';
  if (dayKey === yesterdayKey) return 'Gestern';
  return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()];
}
