import { dateNDaysAgo } from "./date";
import { habitTarget, logCount, perDayTarget } from "./habits";
import { weekKey } from "./week";
import { DEFAULT_SKIP_RULE, periodBucket, type SkipRule } from "./skipRule";
import type { Habit, HabitLog } from "../types";

/** As far back as a single habit's history is walked — same window as the global streak. */
export const HABIT_WINDOW_DAYS = 120;

export interface HabitStats {
  /** Days in a row for a daily habit, weeks in a row for a weekly one. */
  streak: number;
  /** "дней" or "недель" — the unit `streak` is counted in. */
  unit: "days" | "weeks";
  /** The first day it was actually done, or null if it never has been. */
  firstDay: string | null;
  /** Calendar days from `firstDay` to today, inclusive. 0 when it never started. */
  daysSinceStart: number;
  /** The last seven days, oldest first — the strip shown beside the name. */
  week: boolean[];
}

function doneOn(habit: Habit, logs: HabitLog[], date: string): boolean {
  const log = logs.find((l) => l.habitId === habit.id && l.date === date);
  return logCount(log) >= perDayTarget(habit);
}

/**
 * How long this one habit has been running, on its own terms.
 *
 * The global streak answers "did the whole system hold today", which is a different
 * question and the reason this exists: a habit added a week into a 40-day streak inherits
 * that 40 and looks settled when it is three days old.
 *
 * `frozen` is every day this habit is excused from: the shared day-off, plus — when skips
 * are set per habit — the days this habit spent its own chances on. Skipped rather than
 * counted, both ways: the day was forgiven, it was not done.
 */
export function habitStreakDays(habit: Habit, logs: HabitLog[], frozen: string[] = []): number {
  const frozenDays = new Set(frozen);
  let streak = 0;
  for (let i = 0; i < HABIT_WINDOW_DAYS; i++) {
    const day = dateNDaysAgo(i);
    if (doneOn(habit, logs, day)) streak++;
    // Today still being open shouldn't break yesterday's run.
    else if (i === 0) continue;
    else if (frozenDays.has(day)) continue;
    else break;
  }
  return streak;
}

/**
 * Weeks in a row a weekly habit met its target. Counting its days would be meaningless —
 * "спорт 3 раза в неделю" is never a run of consecutive days.
 *
 * The current week is never counted as a failure: it isn't over yet.
 */
export function habitStreakWeeks(habit: Habit, logs: HabitLog[]): number {
  const target = habitTarget(habit).count;
  const doneByWeek = new Map<string, number>();
  for (const l of logs) {
    if (l.habitId !== habit.id || !l.done) continue;
    const key = weekKey(l.date);
    doneByWeek.set(key, (doneByWeek.get(key) ?? 0) + 1);
  }

  const thisWeek = weekKey(dateNDaysAgo(0));
  let streak = 0;
  for (let i = 0; i * 7 < HABIT_WINDOW_DAYS; i++) {
    const key = weekKey(dateNDaysAgo(i * 7));
    const met = (doneByWeek.get(key) ?? 0) >= target;
    if (met) streak++;
    else if (key === thisWeek) continue;
    else break;
  }
  return streak;
}

/** The first day this habit was actually done — its real start, not when it was typed in. */
export function habitFirstDay(habit: Habit, logs: HabitLog[]): string | null {
  let first: string | null = null;
  for (const l of logs) {
    if (l.habitId !== habit.id || !l.done) continue;
    if (first === null || l.date < first) first = l.date;
  }
  return first;
}

/** The last day it was done, or null if it never was. */
export function habitLastDay(habit: Habit, logs: HabitLog[]): string | null {
  let last: string | null = null;
  for (const l of logs) {
    if (l.habitId !== habit.id || !l.done) continue;
    if (last === null || l.date > last) last = l.date;
  }
  return last;
}

/** How many separate days it was done at all. */
export function habitDoneDays(habit: Habit, logs: HabitLog[]): number {
  const days = new Set<string>();
  for (const l of logs) if (l.habitId === habit.id && l.done) days.add(l.date);
  return days.size;
}

export interface HabitRun {
  /** Days actually marked done. */
  doneDays: number;
  firstDay: string | null;
  lastDay: string | null;
  /** Calendar days from the first mark to the last, inclusive. 0 when it never started. */
  span: number;
}

/**
 * What a retired habit amounts to: not "days in a row up to today" — that is always 0 once
 * it stops being ticked — but how long it ran and how many days it got.
 */
export function habitRun(habit: Habit, logs: HabitLog[]): HabitRun {
  const firstDay = habitFirstDay(habit, logs);
  const lastDay = habitLastDay(habit, logs);
  return {
    doneDays: habitDoneDays(habit, logs),
    firstDay,
    lastDay,
    span: firstDay && lastDay ? daysBetweenInclusive(firstDay, lastDay) : 0,
  };
}

/** Calendar days from `from` to `to`, inclusive — "23-й день" counts the first one. */
export function daysBetweenInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1);
}

export function habitStats(habit: Habit, logs: HabitLog[], today: string, frozen: string[] = []): HabitStats {
  const weekly = habitTarget(habit).kind === "weekly";
  const firstDay = habitFirstDay(habit, logs);
  return {
    streak: weekly ? habitStreakWeeks(habit, logs) : habitStreakDays(habit, logs, frozen),
    unit: weekly ? "weeks" : "days",
    firstDay,
    daysSinceStart: firstDay ? daysBetweenInclusive(firstDay, today) : 0,
    week: Array.from({ length: 7 }, (_, i) => doneOn(habit, logs, dateNDaysAgo(6 - i))),
  };
}


/**
 * The day this habit should spend one of its own chances on, or null.
 *
 * The per-habit mirror of freezeCandidate, and the same three rules: only yesterday, only
 * when there was a run to protect, and never two days running whatever the budget says. The
 * difference is what it saves — this habit's own streak in its own report, not the day.
 *
 * Two lists, because a day off and a chance are two different things. `excused` is every day
 * this habit is let off, the shared days included: those keep its run alive and they still
 * count as "a day without a mark" for the two-in-a-row rule. `own` is only the chances this
 * habit has actually spent, and only those come out of its budget — a shared day off was
 * granted by a different rule and is not one of this habit's five.
 *
 * A weekly habit is left out: its streak is counted in weeks, and a missed day is not a
 * missed week.
 */
export function habitFreezeCandidate(
  habit: Habit,
  logs: HabitLog[],
  excused: string[],
  own: string[],
  rule: SkipRule = DEFAULT_SKIP_RULE,
): string | null {
  if (rule.mode !== "perHabit" || rule.count <= 0) return null;
  if (habitTarget(habit).kind === "weekly") return null;

  const yesterday = dateNDaysAgo(1);
  const beforeYesterday = dateNDaysAgo(2);
  if (doneOn(habit, logs, yesterday)) return null;

  const excusedDays = new Set(excused);
  const ownDays = new Set(own);
  if (excusedDays.has(yesterday) || excusedDays.has(beforeYesterday)) return null;
  // Nothing to save: this habit's run had already ended.
  if (!doneOn(habit, logs, beforeYesterday)) return null;

  const bucket = periodBucket(yesterday, rule.period);
  let used = 0;
  if (bucket !== null) {
    for (const day of ownDays) if (periodBucket(day, rule.period) === bucket) used++;
  } else {
    // "За всю цепочку": walk back to the day this habit's run actually ended, counting the
    // chances it spent on the way. A shared day off keeps the walk going and costs nothing.
    for (let i = 2; i < HABIT_WINDOW_DAYS; i++) {
      const day = dateNDaysAgo(i);
      if (ownDays.has(day)) {
        used++;
        continue;
      }
      if (excusedDays.has(day)) continue;
      if (!doneOn(habit, logs, day)) break;
    }
  }
  return used >= rule.count ? null : yesterday;
}
