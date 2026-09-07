import { datesBetween, toDateKey } from "./date";

/**
 * ISO week key ("2026-W35") for a local date key.
 *
 * A weekly review needs one slot per week, not per day, and it needs the week
 * to start on Monday — writing the review on Sunday evening and again on
 * Monday morning should be the same week's review and the following one, not
 * two entries fighting over the same slot.
 */
export function weekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Thursday of the same week decides the year, per ISO 8601 — otherwise the
  // days around New Year land in the wrong one.
  const date = new Date(y, m - 1, d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - day + 3);
  const isoYear = date.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Monday of the week containing `dateKey`, as a date key. */
export function weekStart(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toDateKey(date);
}

/** How many days into the week we are — Monday is 1. */
export function dayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
}

/**
 * Monday through `dateKey`, inclusive — the span a weekly habit's count is taken over.
 *
 * Three screens ask for this, and each had its own copy of the loop; one of them getting the
 * week's first day wrong is the kind of difference nobody would notice until a weekly habit
 * read "2 из 3" on one screen and "1 из 3" on another.
 */
export function weekDatesThrough(dateKey: string): string[] {
  return datesBetween(weekStart(dateKey), dateKey);
}
