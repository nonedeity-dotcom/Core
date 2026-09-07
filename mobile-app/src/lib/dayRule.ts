import { plural } from "./plural";

/**
 * How much of the «ввожу сейчас» pile a day has to close to count.
 *
 * The bar used to be "half of everything", which is why a list of ten things you eventually
 * want made the day ten tall and then let you clear it with five. It became "all of the now
 * pile" — the pile is the bar, which is what makes keeping it short the point rather than a
 * suggestion. That is still the default, and still the rule this app argues for.
 *
 * But it is a rule about your own days, and one size does not fit a week with a fever in it.
 * So it is now yours to set: all of them, a fixed number of them, or a share of them.
 */
export type DayRule =
  | { kind: "all" }
  | { kind: "count"; value: number }
  | { kind: "percent"; value: number };

export const DEFAULT_DAY_RULE: DayRule = { kind: "all" };

/** One habit is the smallest bar that means anything; past twenty the pile is the problem. */
export const MIN_RULE_COUNT = 1;
export const MAX_RULE_COUNT = 20;
/** Below a tenth the rule stops being a rule; a hundred percent is "all" by another name. */
export const MIN_RULE_PERCENT = 10;
export const MAX_RULE_PERCENT = 100;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Anything read back from storage or a backup, turned into a rule or the default. */
export function normalizeDayRule(value: unknown): DayRule {
  if (typeof value !== "object" || value === null) return DEFAULT_DAY_RULE;
  const { kind, value: raw } = value as { kind?: unknown; value?: unknown };
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : NaN;
  if (kind === "count" && !Number.isNaN(n)) return { kind: "count", value: clamp(n, MIN_RULE_COUNT, MAX_RULE_COUNT) };
  if (kind === "percent" && !Number.isNaN(n)) {
    return { kind: "percent", value: clamp(n, MIN_RULE_PERCENT, MAX_RULE_PERCENT) };
  }
  return DEFAULT_DAY_RULE;
}

/**
 * How many of the day's deciding habits have to be closed.
 *
 * Both variable rules are clamped to the size of the pile itself: asking for five habits out
 * of a list of three is a day that can never be closed, and a bar nothing can clear is worse
 * than no bar. Never below one either — a rule that counts an untouched day is not a rule.
 */
export function requiredForDay(rule: DayRule, decidingCount: number): number {
  if (decidingCount <= 0) return 0;
  switch (rule.kind) {
    case "count":
      return clamp(rule.value, 1, decidingCount);
    case "percent":
      return clamp(Math.ceil((decidingCount * rule.value) / 100), 1, decidingCount);
    default:
      return decidingCount;
  }
}

/** The rule in words, with what it works out to for the pile as it stands today. */
export function describeDayRule(rule: DayRule, decidingCount: number): string {
  const required = requiredForDay(rule, decidingCount);
  const of = `${required} из ${decidingCount}`;
  if (decidingCount === 0) {
    if (rule.kind === "count") return `${rule.value} ${plural(rule.value, ["привычка", "привычки", "привычек"])} в день`;
    if (rule.kind === "percent") return `${rule.value}% привычек в день`;
    return "Все привычки из «Ввожу сейчас»";
  }
  switch (rule.kind) {
    case "count":
      // The stored number and what it actually comes to can differ — see the clamp above.
      return rule.value > decidingCount
        ? `${rule.value} в день, а в списке ${decidingCount} — значит ${of}`
        : `${of} каждый день`;
    case "percent":
      return `${rule.value}% — сейчас это ${of}`;
    default:
      return `Все ${decidingCount} ${plural(decidingCount, ["привычка", "привычки", "привычек"])} каждый день`;
  }
}
