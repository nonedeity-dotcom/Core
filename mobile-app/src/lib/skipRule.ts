import { plural } from "./plural";
import { weekKey } from "./week";

/**
 * Пропуски — the chances a skipped day gets before it breaks a chain.
 *
 * Их два, и они работают одновременно. Общий держит день целиком: не сделал ничего —
 * общая серия уцелела. Отдельный держит одну привычку: пропустил зарядку, но день закрыл
 * остальным — её собственная серия уцелела.
 *
 * Раньше это был выбор «или-или», и в нём была дыра, из-за которой всё и переписано:
 * поставив шанс на каждую привычку, человек оставлял общий день без защиты вовсе. Один
 * день, в который не сделано ничего, рвал общую серию, хотя у каждой привычки шансы были
 * не тронуты. Два разных вопроса — «уцелел ли день» и «уцелела ли привычка» — решались
 * одним переключателем, и один из ответов всегда терялся.
 *
 * Two things it deliberately does not do. It never forgives two skipped days in a row,
 * however much budget is left — a second day off is not a slip, it is a stop, and a chain
 * that survives an open-ended gap is not measuring anything. And it never rescues a day
 * retroactively: a chance is spent on yesterday, at the moment yesterday closed, so the
 * number cannot move under someone who has already read it.
 */
export type SkipPeriod =
  /** The budget lasts the whole chain and refills only when the chain breaks. */
  | "streak"
  /** Refills on the 1st. */
  | "month"
  /** Refills on Monday. */
  | "week";

/** Один запас: сколько прощается и как часто пополняется. Ноль — не прощается ничего. */
export interface SkipBudget {
  /** 0 turns skips off entirely — every miss breaks. */
  count: number;
  period: SkipPeriod;
}

export interface SkipRule {
  /** Держит общую серию: день, в который не набралось нужного числа привычек. */
  shared: SkipBudget;
  /** Держит собственную серию каждой привычки, у каждой свой запас. */
  perHabit: SkipBudget;
}

/** Exactly what the app did before any of this was settable: one shared skip a week. */
export const DEFAULT_SKIP_RULE: SkipRule = {
  shared: { count: 1, period: "week" },
  perHabit: { count: 0, period: "week" },
};

/** Есть ли вообще что тратить — короткая проверка для экранов. */
export const anySkips = (rule: SkipRule): boolean => rule.shared.count > 0 || rule.perHabit.count > 0;

/** Past twenty a "chain" of days stops being a chain. */
export const MAX_SKIPS = 20;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const readPeriod = (v: unknown): SkipPeriod => (v === "streak" || v === "month" ? v : "week");

function readBudget(value: unknown, fallback: SkipBudget): SkipBudget {
  if (typeof value !== "object" || value === null) return { ...fallback };
  const { count, period } = value as Record<string, unknown>;
  const n = typeof count === "number" && Number.isFinite(count) ? Math.round(count) : NaN;
  return {
    count: Number.isNaN(n) ? fallback.count : clamp(n, 0, MAX_SKIPS),
    period: readPeriod(period),
  };
}

/**
 * Принимает и нынешнюю форму, и прежнюю — ту, где режим был один на двоих.
 *
 * Прежняя запись переезжает в тот запас, которым и была: стоял общий — общий и останется,
 * стоял на каждую привычку — останется на каждую. Второй заводится нулевым, то есть
 * выключенным. Молча включить то, о чём не просили, было бы хуже: человек настраивал
 * строгость под себя, и обновление не повод её ослаблять.
 */
export function normalizeSkipRule(value: unknown): SkipRule {
  if (typeof value !== "object" || value === null) return DEFAULT_SKIP_RULE;
  const o = value as Record<string, unknown>;

  if (o.shared !== undefined || o.perHabit !== undefined) {
    return {
      shared: readBudget(o.shared, DEFAULT_SKIP_RULE.shared),
      perHabit: readBudget(o.perHabit, DEFAULT_SKIP_RULE.perHabit),
    };
  }

  // Прежняя форма: { mode, count, period }.
  const legacy = readBudget(o, { count: DEFAULT_SKIP_RULE.shared.count, period: "week" });
  const off: SkipBudget = { count: 0, period: legacy.period };
  return o.mode === "perHabit" ? { shared: off, perHabit: legacy } : { shared: legacy, perHabit: off };
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

/** Один запас словами. */
export function describeBudget(b: SkipBudget): string {
  if (b.count === 0) return "выключен";
  return `${b.count} ${plural(b.count, ["пропуск", "пропуска", "пропусков"])} ${periodWord(b.period)}`;
}

/** Оба запаса в одну строку, для карточки настройки. */
export function describeSkipRule(rule: SkipRule): string {
  const parts: string[] = [];
  if (rule.shared.count > 0) parts.push(`общий: ${describeBudget(rule.shared)}`);
  if (rule.perHabit.count > 0) parts.push(`на привычку: ${describeBudget(rule.perHabit)}`);
  return parts.length === 0 ? "Выключены — любой пропуск рвёт цепочку" : parts.join(" · ");
}
