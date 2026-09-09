// One source of truth for "which day is it" across the app.
//
// Every screen used to do `new Date().toISOString().slice(0, 10)`, which is the
// UTC date, not the user's. For anyone east of UTC that makes the checklist
// roll over mid-morning (03:00 in UTC+3), and for anyone west of it the evening
// already counts as tomorrow — habits, streaks and focus sessions all landed in
// the wrong day's bucket. These helpers use the device's own calendar day.

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "yyyy-MM-dd" for a Date, in the device's local timezone (never UTC). */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local date as "yyyy-MM-dd" — the key every screen stores against. */
export function todayKey(): string {
  return toDateKey(new Date());
}

/**
 * Tomorrow, locally — the day a habit added now starts being required.
 *
 * Stamping a new habit with *today* meant adding one at nine in the morning retroactively
 * un-completed a day that was already closed, and the streak dropped by one until the new
 * habit was ticked. A day you have already finished should not stop counting because you
 * planned something new during it.
 */
export function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateKey(d);
}

/** Local date key n days back from today (n = 0 is today). */
export function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateKey(d);
}

const WEEKDAY_LABELS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/**
 * Short Russian weekday for a "yyyy-MM-dd" key. Parsed field-by-field on
 * purpose: `new Date("2026-08-31")` is midnight *UTC*, so reading .getDay()
 * off it returned the previous weekday for every user in a negative offset.
 */
export function weekdayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()];
}

/**
 * "01.09.2026" from a date key or a full ISO timestamp. Written out by hand
 * rather than via toLocaleDateString: Intl is not guaranteed to carry the ru
 * locale in every Hermes build, and a silent fallback to US ordering would put
 * the month where the day should be.
 */
export function formatDateShort(value: string): string {
  const local = value.includes("T") ? toDateKey(new Date(value)) : value;
  const [y, m, d] = local.split("-");
  return y && m && d ? `${d}.${m}.${y}` : local;
}

/**
 * Every date key from `from` to `to`, both ends included.
 *
 * Walked with a real Date rather than by adding days to a string, so months, years and the
 * days a timezone shifts all come out right.
 */
export function datesBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: string[] = [];
  const cursor = new Date(y, m - 1, d);
  while (toDateKey(cursor) <= to) {
    out.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Соседний день от ключа: `shiftDate("2026-09-01", -1)` → "2026-08-31".
 *
 * Считается настоящей датой, а не арифметикой по строке, поэтому месяцы, годы и високосный
 * февраль получаются сами. Полдень взят намеренно: в дни перевода часов полночь может
 * съехать на сутки назад, а полдень — нет.
 */
export function shiftDate(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const cursor = new Date(y, m - 1, d, 12);
  cursor.setDate(cursor.getDate() + delta);
  return toDateKey(cursor);
}

/**
 * Сколько дней от `from` до `to` (отрицательно, если `to` раньше).
 *
 * Через UTC-полночь обеих дат: это не время, а номер календарного дня, и разница номеров не
 * должна зависеть ни от часового пояса, ни от перевода часов.
 */
export function daysBetween(from: string, to: string): number {
  const dayNumber = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return dayNumber(to) - dayNumber(from);
}
