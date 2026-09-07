import { toDateKey } from "./date";
import { weekStart } from "./week";
import { habitsThatDecideTheDay, logCount, perDayTarget } from "./habits";
import { dayCounts } from "./streak";
import { DEFAULT_DAY_RULE, type DayRule } from "./dayRule";
import type { Habit, HabitLog } from "../types";

export type DayState = "full" | "minimal" | "frozen" | "missed" | "future";

export interface Cell {
  /** null for the blank leading cells a real month starts with. */
  date: string | null;
  day: number;
  state: DayState;
  isToday: boolean;
}

export type CalendarMode = "month" | "weeks";
export const GRID_WEEKS = 4;

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** "2026-09" */
export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const now = new Date();
  const name = MONTHS[m - 1] ?? key;
  // The year is only worth the space when it isn't the current one.
  return y === now.getFullYear() ? name : `${name} ${y}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  return { from: `${key}-01`, to: toDateKey(new Date(y, m, 0)) };
}

/**
 * Which days count, and whether the minimal version is what got them there.
 *
 * "По минимуму" means the day only reached the target because minimal ticks
 * counted — not merely that one of its ticks happened to be a small one.
 */
export function computeDayStates(
  habits: Habit[],
  logs: HabitLog[],
  rule: DayRule = DEFAULT_DAY_RULE,
): Map<string, "full" | "minimal"> {
  const states = new Map<string, "full" | "minimal">();
  const deciding = habitsThatDecideTheDay(habits);
  if (deciding.length === 0) return states;

  // Same verdict the streak uses — the calendar filling a day the streak refused to count
  // is the kind of disagreement nobody can debug from the outside.
  const decidingIds = new Set(deciding.map((h) => h.id));
  for (const date of new Set(logs.map((l) => l.date))) {
    if (!dayCounts(habits, logs, date, rule)) continue;
    const minimal = logs.some((l) => l.date === date && l.done && l.minimal && decidingIds.has(l.habitId));
    states.set(date, minimal ? "minimal" : "full");
  }
  return states;
}

/**
 * The month for one habit alone: a day is filled when that habit met its own target, not
 * when the day as a whole counted. Used by the per-habit report, where the question is
 * "when did I skip *this*" rather than "did the day hold".
 */
export function singleHabitDayStates(habit: Habit, logs: HabitLog[]): Map<string, "full" | "minimal"> {
  const states = new Map<string, "full" | "minimal">();
  const target = perDayTarget(habit);
  for (const l of logs) {
    if (l.habitId !== habit.id) continue;
    if (logCount(l) < target) continue;
    states.set(l.date, l.minimal ? "minimal" : "full");
  }
  return states;
}

function cellFor(
  key: string,
  today: string,
  states: Map<string, "full" | "minimal">,
  day: number,
  frozen?: Set<string>,
): Cell {
  // A frozen day is drawn as its own thing, never as a done one: it kept the chain, it did
  // not do the work, and showing it filled in would make the calendar lie about the month.
  const state: DayState =
    key > today ? "future" : (states.get(key) ?? (frozen?.has(key) ? "frozen" : "missed"));
  return { date: key, day, state, isToday: key === today };
}

/** The rolling window: whole weeks ending with the one containing today. */
export function buildWeeksGrid(today: string, states: Map<string, "full" | "minimal">, frozen?: Set<string>): Cell[] {
  const [y, m, d] = weekStart(today).split("-").map(Number);
  const start = new Date(y, m - 1, d);
  start.setDate(start.getDate() - (GRID_WEEKS - 1) * 7);

  return Array.from({ length: GRID_WEEKS * 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return cellFor(toDateKey(date), today, states, date.getDate(), frozen);
  });
}

/**
 * A real calendar month: blank cells up to the 1st so the columns stay
 * weekdays. That alignment is the point — a column of gaps under вс says
 * something a rolling strip of 28 days can't.
 */
export function buildMonthGrid(
  key: string,
  today: string,
  states: Map<string, "full" | "minimal">,
  frozen?: Set<string>,
): Cell[] {
  const [y, m] = key.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(y, m, 0).getDate();

  const cells: Cell[] = Array.from({ length: lead }, () => ({
    date: null,
    day: 0,
    state: "future" as DayState,
    isToday: false,
  }));
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(cellFor(`${key}-${String(day).padStart(2, "0")}`, today, states, day, frozen));
  }
  // Pad to whole rows so the grid doesn't reflow as months change length.
  while (cells.length % 7 !== 0) cells.push({ date: null, day: 0, state: "future", isToday: false });
  return cells;
}

export function countedDays(cells: Cell[]): number {
  return cells.filter((c) => c.state === "full" || c.state === "minimal").length;
}

export function elapsedDays(cells: Cell[]): number {
  return cells.filter((c) => c.date !== null && c.state !== "future").length;
}

/**
 * The same span one period earlier, compared over the same number of elapsed
 * days. Comparing two days of this week against seven of last week would
 * always read as a loss.
 */
export function compareWithPrevious(
  mode: CalendarMode,
  key: string,
  today: string,
  states: Map<string, "full" | "minimal">,
): number | null {
  if (mode === "weeks") {
    const cells = buildWeeksGrid(today, states);
    const thisWeek = cells.slice(-7);
    const elapsed = thisWeek.filter((c) => c.state !== "future").length;
    if (elapsed === 0) return null;
    return countedDays(thisWeek) - countedDays(cells.slice(-14, -7).slice(0, elapsed));
  }

  const current = buildMonthGrid(key, today, states).filter((c) => c.date !== null);
  const elapsed = current.filter((c) => c.state !== "future").length;
  if (elapsed === 0) return null;
  const previous = buildMonthGrid(shiftMonth(key, -1), today, states).filter((c) => c.date !== null);
  if (previous.length === 0) return null;
  return countedDays(current) - countedDays(previous.slice(0, elapsed));
}
