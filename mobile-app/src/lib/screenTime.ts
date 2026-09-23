/**
 * The rule for how far we may trust creker's screen-time number — kept apart from
 * the native bridge in src/integrations/screenTime.ts so it stays a pure function
 * over plain data (and can be exercised without an Android device).
 */

/** The shape this rule needs out of a creker `device_usage` row. */
export interface ScreenTimeRow {
  screenMillis: number;
  /**
   * Epoch millis up to which `screenMillis` is complete for that day — creker's
   * `updated_at`, which is *not* the moment the row was written. `0` means
   * unknown: a creker build older than the column, or a day it never finished
   * measuring.
   */
  updatedAt: number;
}

/**
 * How far behind creker's measurement may lag before it stops speaking for the day.
 * creker syncs in the background and the OS can doze it, so demanding a
 * to-the-minute figure would mean the habit never ticks itself; two hours survives
 * an ordinary doze window while still muting a creker that has actually stalled.
 */
export const FRESHNESS_TOLERANCE_MS = 2 * 60 * 60 * 1000;

export type ScreenTimeVerdict =
  | { action: "tick"; withinLimit: boolean }
  | { action: "skip"; reason: "no-data" | "incomplete" };

/** Local midnight that ends `date` ("yyyy-MM-dd"), i.e. the start of the next day. */
export function endOfLocalDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
}

/**
 * Правило привычки: какое приложение и сколько ему позволено.
 *
 * `app` — либо имя пакета, либо `TOTAL_APP` для всего экранного времени. Название хранится
 * рядом с пакетом: приложение могут удалить, а привычка «не больше часа в тиктоке» должна
 * остаться читаемой и после этого.
 */
export interface ScreenRule {
  app: string;
  label?: string;
  limitMin: number;
  /**
   * В какую сторону планка: «не больше» — для того, от чего отвыкают (TikTok), «не
   * меньше» — для того, к чему привыкают (читалка, Duolingo).
   *
   * Отсутствует у всех правил, заведённых до «не меньше», и значит «не больше» — единственное,
   * что тогда умела такая привычка.
   */
  direction?: ScreenDirection;
}

export type ScreenDirection = "atMost" | "atLeast";

export const ruleDirection = (rule: ScreenRule): ScreenDirection => rule.direction ?? "atMost";

/** «Всё экранное время» — не пакет, и спутать его с пакетом нельзя: точка в начале. */
export const TOTAL_APP = ".total";

export const isTotal = (rule: ScreenRule): boolean => rule.app === TOTAL_APP;

/** Потолок лимита — тот же, что и в редакторе: шестнадцать часов, дольше суток не бывает. */
export const MAX_LIMIT_MIN = 16 * 60;

/**
 * Правило из чего угодно — для восстановления из резервной копии.
 *
 * Без него привычка «не больше часа в тиктоке» пережила бы перенос на новый телефон
 * обычной привычкой с галочкой: разбор копии собирает привычку по известным полям, а всё
 * остальное молча отбрасывает.
 */
export function normalizeScreenRule(value: unknown): ScreenRule | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.app !== "string" || v.app === "") return null;
  const limit = typeof v.limitMin === "number" && Number.isFinite(v.limitMin) ? Math.round(v.limitMin) : 0;
  if (limit <= 0) return null;
  return {
    app: v.app,
    ...(typeof v.label === "string" && v.label !== "" ? { label: v.label } : {}),
    limitMin: Math.min(MAX_LIMIT_MIN, limit),
    // Хранится только «не меньше»: «не больше» — это отсутствие поля, как и было всегда.
    ...(v.direction === "atLeast" ? { direction: "atLeast" as const } : {}),
  };
}

/**
 * What creker's row for `date` actually licenses us to say about the habit.
 *
 * `screenMillis` only ever grows during a day, which makes the two directions
 * unequal. Once it is past the limit the day is spent no matter what happens
 * later, so "over" is safe to act on even from a lagging row. "Under" is a claim
 * about the rest of the day, and a row creker hasn't caught up on doesn't support
 * it — a day it never measured reads as a flat 0, which would otherwise tick
 * "screen time is fine" on a day spent entirely on the phone. So an under-limit
 * row is believed only when creker measured through the point being asked about:
 * now, or the day's end once the day is past.
 */
export function decideScreenTimeHabit(
  row: ScreenTimeRow | undefined,
  limitMin: number,
  nowMs: number,
  date: string,
): ScreenTimeVerdict {
  if (!row) return { action: "skip", reason: "no-data" };
  return decideUsage(row.screenMillis, row.updatedAt, limitMin, nowMs, date);
}

/**
 * То же решение, но про любое время, а не только про общее.
 *
 * Отдельная функция понадобилась, когда привычка научилась смотреть на одно приложение:
 * у строки приложения своей отметки о свежести нет, она есть только у дня целиком. То
 * есть время берётся из одной строки, а доверие к нему — из другой, и склеивать их
 * внутри правила было бы неправдой о том, что оно знает.
 *
 * Асимметрия та же и по той же причине: израсходованное время только растёт. «Превысил» —
 * утверждение про уже случившееся, и его можно сделать даже по отставшей строке.
 * «Уложился» — утверждение про весь день, и непосчитанный день читается нулём, то есть
 * сутками в телефоне выглядел бы образцовым.
 */
export function decideUsage(
  usedMillis: number,
  updatedAt: number,
  limitMin: number,
  nowMs: number,
  date: string,
): ScreenTimeVerdict {
  if (usedMillis > limitMin * 60_000) return { action: "tick", withinLimit: false };

  // No stamp at all: nothing was measured, so there is nothing to compare.
  if (!updatedAt) return { action: "skip", reason: "incomplete" };

  const measuredThrough = Math.min(nowMs, endOfLocalDay(date));
  if (measuredThrough - updatedAt > FRESHNESS_TOLERANCE_MS) {
    return { action: "skip", reason: "incomplete" };
  }
  return { action: "tick", withinLimit: true };
}

/** Что правило привычки говорит про день: отметить (сделано или нет) или промолчать. */
export type RuleVerdict = { action: "tick"; done: boolean } | { action: "skip"; reason: "incomplete" };

/**
 * Решение по правилу привычки — в обе стороны.
 *
 * У «не больше» и «не меньше» асимметрия зеркальная, и держится она на одном и том же:
 * потраченное за день время только растёт.
 *
 * «Не больше». Превысил — это уже случилось, и видно даже по отставшей строке. «Уложился» —
 * утверждение про весь день, и ему нужна строка, домеренная до «сейчас» (или до конца дня).
 *
 * «Не меньше». Набрал — уже случилось, отмечается сразу, в любой момент дня. «Не набрал» —
 * утверждение про весь день: пока день идёт, ещё не поздно, и снимать галочку в обед за то,
 * что к вечеру ещё можно успеть, было бы враньём. Такое говорится только про законченный
 * день, и только если он домерен до конца.
 */
export function decideRule(
  rule: ScreenRule,
  usedMillis: number,
  updatedAt: number,
  nowMs: number,
  date: string,
): RuleVerdict {
  const limitMs = rule.limitMin * 60_000;

  if (ruleDirection(rule) === "atMost") {
    const v = decideUsage(usedMillis, updatedAt, rule.limitMin, nowMs, date);
    return v.action === "tick" ? { action: "tick", done: v.withinLimit } : { action: "skip", reason: "incomplete" };
  }

  if (usedMillis >= limitMs) return { action: "tick", done: true };

  const end = endOfLocalDay(date);
  if (nowMs < end) return { action: "skip", reason: "incomplete" };
  if (!updatedAt || end - updatedAt > FRESHNESS_TOLERANCE_MS) return { action: "skip", reason: "incomplete" };
  return { action: "tick", done: false };
}
