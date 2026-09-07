import { plural } from "./plural";
import { weekKey } from "./week";

/**
 * Пропуски — the chances a skipped day gets before it breaks a chain.
 *
 * There has always been exactly one of these: a single day a week that the streak forgives.
 * This makes the number, the period it refills over, and *what* it protects into settings.
 *
 * Two things it deliberately does not do. It never forgives two skipped days in a row,
 * however much budget is left — a second day off is not a slip, it is a stop, and a chain
 * that survives an open-ended gap is not measuring anything. And it never rescues a day
 * retroactively: a chance is spent on yesterday, at the moment yesterday closed, so the
 * number cannot move under someone who has already read it.
 */
export type SkipMode =
  /** One budget for the whole day: a skipped day keeps the main streak. */
  | "shared"
  /** A budget per habit: a skipped day keeps that habit's own streak, not the day. */
  | "perHabit";

export type SkipPeriod =
  /** The budget lasts the whole chain and refills only when the chain breaks. */
  | "streak"
  /** Refills on the 1st. */
  | "month"
  /** Refills on Monday. */
  | "week";

export interface SkipRule {
  mode: SkipMode;
  /** 0 turns skips off entirely — every miss breaks. */
  count: number;
  period: SkipPeriod;
}

/** Exactly what the app did before any of this was settable: one shared skip a week. */
export const DEFAULT_SKIP_RULE: SkipRule = { mode: "shared", count: 1, period: "week" };

/** Past twenty a "chain" of days stops being a chain. */
export const MAX_SKIPS = 20;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function normalizeSkipRule(value: unknown): SkipRule {
  if (typeof value !== "object" || value === null) return DEFAULT_SKIP_RULE;
  const { mode, count, period } = value as Record<string, unknown>;
  const n = typeof count === "number" && Number.isFinite(count) ? Math.round(count) : NaN;
  return {
    mode: mode === "perHabit" ? "perHabit" : "shared",
    count: Number.isNaN(n) ? DEFAULT_SKIP_RULE.count : clamp(n, 0, MAX_SKIPS),
    period: period === "streak" || period === "month" ? period : "week",
  };
}

/**
 * Which bucket of the budget a given day is charged to, or null when the budget is not
 * measured in calendar periods at all ("за всю цепочку" — counted against the run instead,
 * which only the streak walk can see).
 */
export function periodBucket(date: string, period: SkipPeriod): string | null {
  if (period === "week") return weekKey(date);
  if (period === "month") return date.slice(0, 7);
  return null;
}

function periodWord(period: SkipPeriod): string {
  if (period === "week") return "в неделю";
  if (period === "month") return "в месяц";
  return "на всю цепочку";
}

/** The rule in one line, for the card that sets it. */
export function describeSkipRule(rule: SkipRule): string {
  if (rule.count === 0) return "Выключены — любой пропуск рвёт цепочку";
  const n = `${rule.count} ${plural(rule.count, ["пропуск", "пропуска", "пропусков"])} ${periodWord(rule.period)}`;
  return rule.mode === "shared"
    ? `${n} · держат общую серию`
    : `${n} на каждую привычку · держат её собственную серию`;
}
