import { toDateKey } from "./date";
import { DEFAULT_DAY_OFF, isDayOff, type DayOffRule } from "./dayOff";
import { weekKey } from "./week";
import type { FocusSession } from "../types";

/** Monday first, the way the calendar and the ISO week keys already order days. */
export const WEEKDAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export interface WeekdayStat {
  /** 0 = Monday. */
  index: number;
  /** Days of this weekday that counted. */
  counted: number;
  /** Days of this weekday that have happened at all. */
  total: number;
}

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const cursor = new Date(y, m - 1, d);
  // A hard stop, so a corrupt date can't spin here forever.
  for (let i = 0; i < 4000; i++) {
    const key = toDateKey(cursor);
    if (key > to) break;
    out.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Monday-first weekday index for a date key. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/**
 * How often each weekday held.
 *
 * The one pattern nothing else in the app can show: a streak counts forwards and says
 * nothing about *which* day keeps breaking it. "Воскресенье — 2 из 8" is something you can
 * act on, by putting the minimal version there rather than trying harder.
 *
 * Today is left out — it isn't over, and counting it as a failure would drag its weekday
 * down every week.
 */
export function weekdayBreakdown(counted: Set<string>, from: string, today: string): WeekdayStat[] {
  const stats: WeekdayStat[] = WEEKDAY_LABELS.map((_, index) => ({ index, counted: 0, total: 0 }));
  for (const date of dateRange(from, today)) {
    if (date >= today) continue;
    const stat = stats[weekdayIndex(date)];
    stat.total += 1;
    if (counted.has(date)) stat.counted += 1;
  }
  return stats;
}

export interface StreakSummary {
  /** The run in progress, counting back from today. */
  current: number;
  /** The longest run ever. */
  best: number;
  /** How many times a run started after an earlier one had ended. */
  restarts: number;
  /** Mean length of finished runs, rounded. 0 when none have finished. */
  average: number;
}

/**
 * Every run in the history, not just the one in progress.
 *
 * The report's number resets to zero on one missed day, which is the point of a streak but
 * a poor picture of a year: it cannot tell "never managed more than four days" from "held
 * fifty and slipped once".
 */
export function streakSummary(
  counted: Set<string>,
  frozen: string[],
  from: string,
  today: string,
  daysOff: DayOffRule = DEFAULT_DAY_OFF,
): StreakSummary {
  const frozenDays = new Set(frozen);
  const runs: number[] = [];
  let run = 0;

  for (const date of dateRange(from, today)) {
    if (counted.has(date)) {
      run += 1;
      continue;
    }
    // A frozen day, and today while it is still open, are neither a success nor a break.
    // Выходной — то же самое. Без него это число расходилось с серией на главном экране:
    // там цепочка шла, а здесь обрывалась на каждом объявленном выходном.
    if (frozenDays.has(date) || isDayOff(date, daysOff) || date === today) continue;
    if (run > 0) runs.push(run);
    run = 0;
  }

  const current = run;
  const finished = runs;
  const all = current > 0 ? [...finished, current] : finished;
  return {
    current,
    best: all.length ? Math.max(...all) : 0,
    // Every run after the first one began as a restart.
    restarts: Math.max(0, all.length - 1),
    average: finished.length ? Math.round(finished.reduce((a, b) => a + b, 0) / finished.length) : 0,
  };
}

export interface FocusWeek {
  week: string;
  minutes: number;
}

/**
 * Focus time by ISO week, oldest first, with empty weeks kept so the trend has no gaps —
 * a week with no sessions is the most informative bar on the chart.
 */
export function focusByWeek(sessions: FocusSession[], from: string, today: string): FocusWeek[] {
  const totals = new Map<string, number>();
  for (const date of dateRange(from, today)) totals.set(weekKey(date), 0);
  for (const s of sessions) {
    const key = weekKey(s.date);
    if (!totals.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, s.durationMin));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, minutes]) => ({ week, minutes }));
}

export function totalFocusMinutes(sessions: FocusSession[]): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, s.durationMin), 0);
}

/** "12 ч 30 мин", or "45 мин" while it is still under an hour. */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}
