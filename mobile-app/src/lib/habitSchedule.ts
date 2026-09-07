import { habitTarget } from "./habits";
import { dayOfWeek } from "./week";
import type { Habit, HabitSchedule } from "../types";

/**
 * Reading a habit's schedule: how it is written down, how it reads, and where the clock
 * stands against it right now.
 *
 * A time is worth setting for the habits that only work at a particular hour — "час без
 * телефона с утра" is not the same thing at four in the afternoon — and for the rest it is a
 * rule with nothing behind it. So no schedule is the default, and it means whenever.
 */

export const MINUTES_IN_DAY = 24 * 60;

/** What happens when the window closes on an unticked habit. */
export type LateRule =
  /** The time is a reminder, not a rule: a late tick still counts. */
  | "none"
  /** The window closes and the day is lost — the tick is refused, not silently ignored. */
  | "fail";

export const DEFAULT_LATE_RULE: LateRule = "none";

export function normalizeLateRule(value: unknown): LateRule {
  return value === "fail" ? "fail" : "none";
}

const clampMinute = (n: number) => Math.min(MINUTES_IN_DAY - 1, Math.max(0, Math.round(n)));

export function normalizeSchedule(value: unknown): HabitSchedule | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const out: HabitSchedule = {};
  if (typeof v.from === "number" && Number.isFinite(v.from)) out.from = clampMinute(v.from);
  if (typeof v.to === "number" && Number.isFinite(v.to)) out.to = clampMinute(v.to);
  // A window that ends before it starts is not a window. The end is dropped rather than the
  // start, which leaves a deadline — the closest honest reading of a broken pair.
  if (out.from !== undefined && out.to !== undefined && out.to <= out.from) delete out.to;
  if (out.to !== undefined && out.from === undefined) {
    out.from = out.to;
    delete out.to;
  }
  if (v.late === "none" || v.late === "fail") out.late = v.late;
  if (Array.isArray(v.days)) {
    const days = [...new Set(v.days.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7))].sort();
    if (days.length > 0 && days.length < 7) out.days = days;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** "8:00", "22:00–23:00", or null when there is no time set. */
export function formatWindow(schedule: HabitSchedule | undefined): string | null {
  if (!schedule || schedule.from === undefined) return null;
  const at = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return schedule.to === undefined ? at(schedule.from) : `${at(schedule.from)}–${at(schedule.to)}`;
}

const DAY_NAMES = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** "пн, ср, пт", or null when every day is fair game. */
export function formatDays(schedule: HabitSchedule | undefined): string | null {
  if (!schedule?.days || schedule.days.length === 0) return null;
  return schedule.days.map((d) => DAY_NAMES[d]).join(", ");
}

/** The whole schedule in one line, for the row under a habit's name. */
export function formatSchedule(schedule: HabitSchedule | undefined): string | null {
  const window = formatWindow(schedule);
  const days = formatDays(schedule);
  if (window && days) return `${days} · ${window}`;
  return window ?? days;
}

/** Days a weekly habit is expected on — every day when none were chosen. */
export function scheduledDays(schedule: HabitSchedule | undefined): number[] {
  return schedule?.days && schedule.days.length > 0 ? schedule.days : [1, 2, 3, 4, 5, 6, 7];
}

/** Whether this habit is expected on the given date at all. */
export function scheduledOn(habit: Habit, date: string): boolean {
  const days = habit.schedule?.days;
  if (!days || days.length === 0) return true;
  // Only a weekly habit narrows to particular days; a daily one is owed every day.
  if (habitTarget(habit).kind !== "weekly") return true;
  return days.includes(dayOfWeek(date));
}

export type WindowState =
  /** No time set, or the clock is inside the window: go ahead. */
  | "open"
  /** Set for later today — nothing to do yet. */
  | "early"
  /** The window has closed. Whether that costs the day is the LateRule's business. */
  | "late";

/**
 * Where the clock stands against this habit's window right now.
 *
 * `nowMinutes` is passed in rather than read here so every screen sees the same minute and
 * a test can stand at any hour it likes.
 */
export function windowState(schedule: HabitSchedule | undefined, nowMinutes: number): WindowState {
  if (!schedule || schedule.from === undefined) return "open";
  const end = schedule.to ?? schedule.from;
  if (nowMinutes < schedule.from) return "early";
  return nowMinutes > end ? "late" : "open";
}

/**
 * The rule this habit actually runs under: its own answer if it gave one, otherwise the
 * default from «Настройки админа».
 */
export function effectiveLateRule(habit: Habit, fallback: LateRule = DEFAULT_LATE_RULE): LateRule {
  return habit.schedule?.late ?? fallback;
}

/**
 * Whether a tick right now should be accepted.
 *
 * Only "fail" ever refuses, and only after the window has closed — the point of that setting
 * is that a missed window costs the day, and quietly accepting the tick anyway would make it
 * a setting that does nothing. Before the window opens the tick is allowed: doing something
 * early is not the failure the rule is about.
 */
export function canMarkNow(habit: Habit, fallback: LateRule, nowMinutes: number): boolean {
  if (effectiveLateRule(habit, fallback) !== "fail") return true;
  return windowState(habit.schedule, nowMinutes) !== "late";
}
