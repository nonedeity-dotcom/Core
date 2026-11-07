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
export type DayRuleCore =
  | { kind: "all" }
  | { kind: "count"; value: number }
  | { kind: "percent"; value: number };

/**
 * Правило, которое действовало *до* даты `until` (не включая её).
 *
 * Правило дня — это правило про то, как судить дни, и судить их надо по тому, что стояло
 * в тот день. Раньше стояла одна настройка на всю историю: опустишь «50%» до «30%» — и все
 * прошлые дни, где сделано от 30 до 50, задним числом становились закрытыми, а серия росла
 * на днях, которые по тогдашнему правилу провалены.
 */
export interface DayRuleEra {
  until: string;
  rule: DayRuleCore;
}

/**
 * Нынешнее правило плюс то, что действовало до него.
 *
 * `kind` и `value` сверху — это правило, которое действует сейчас (с последней смены и
 * дальше), поэтому всё, что читает только его — шапка «Сегодня закрыто 2 из 5 · нужно 2»,
 * `requiredForDay`, карточка в настройках, — продолжает работать как работало. Историю
 * читает только тот, кто судит конкретный день: см. ruleForDate. Правило без `history`
 * (записанное до появления истории) действует на все дни.
 */
export type DayRule = DayRuleCore & { history?: DayRuleEra[] };

export const DEFAULT_DAY_RULE: DayRule = { kind: "all" };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Смен правила за всю жизнь приложения столько не бывает; предел нужен только от мусора. */
const MAX_ERAS = 100;

/** One habit is the smallest bar that means anything; past twenty the pile is the problem. */
export const MIN_RULE_COUNT = 1;
export const MAX_RULE_COUNT = 20;
/** Below a tenth the rule stops being a rule; a hundred percent is "all" by another name. */
export const MIN_RULE_PERCENT = 10;
export const MAX_RULE_PERCENT = 100;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Само правило, без истории: то, что читается из `kind` и `value`. */
function coreOf(value: unknown): DayRuleCore {
  if (typeof value !== "object" || value === null) return { kind: "all" };
  const { kind, value: raw } = value as { kind?: unknown; value?: unknown };
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : NaN;
  if (kind === "count" && !Number.isNaN(n)) return { kind: "count", value: clamp(n, MIN_RULE_COUNT, MAX_RULE_COUNT) };
  if (kind === "percent" && !Number.isNaN(n)) {
    return { kind: "percent", value: clamp(n, MIN_RULE_PERCENT, MAX_RULE_PERCENT) };
  }
  return { kind: "all" };
}

const sameRule = (a: DayRuleCore, b: DayRuleCore) =>
  a.kind === b.kind && (a.kind === "all" || (b.kind !== "all" && a.value === b.value));

function normalizeEras(value: unknown): DayRuleEra[] {
  if (!Array.isArray(value)) return [];
  // По дате: две записи на один день — это одна, и верна последняя.
  const byDate = new Map<string, DayRuleEra>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { until, rule } = raw as { until?: unknown; rule?: unknown };
    if (typeof until !== "string" || !DATE_KEY.test(until)) continue;
    if (typeof rule !== "object" || rule === null) continue;
    byDate.set(until, { until, rule: coreOf(rule) });
  }
  return [...byDate.values()].sort((a, b) => a.until.localeCompare(b.until)).slice(-MAX_ERAS);
}

const withHistory = (core: DayRuleCore, eras: DayRuleEra[]): DayRule =>
  eras.length > 0 ? { ...core, history: eras } : core;

/** Anything read back from storage or a backup, turned into a rule or the default. */
export function normalizeDayRule(value: unknown): DayRule {
  if (typeof value !== "object" || value === null) return DEFAULT_DAY_RULE;
  const core = coreOf(value);
  const eras = normalizeEras((value as { history?: unknown }).history);
  return withHistory(core, eras);
}

/**
 * По какому правилу судится этот день.
 *
 * Первая смена, которая случилась позже дня, и есть то, что стояло в тот день: каждая запись
 * истории говорит «до такой-то даты действовало вот это». Если такой нет — день не старше
 * последней смены, и судит нынешнее правило. Правило без истории судит всех.
 */
export function ruleForDate(rule: DayRule, date: string): DayRuleCore {
  for (const era of rule.history ?? []) if (date < era.until) return era.rule;
  return coreOf(rule);
}

/**
 * Меняет правило с сегодняшнего дня, а не задним числом.
 *
 * Старое правило остаётся в истории за все дни до сегодня, а новое судит сегодня и дальше.
 * Сегодня — потому что день ещё идёт, и судить его по правилу, которое успели сменить
 * утром, не к чему.
 *
 * Несколько смен за один день складываются в одну: старое правило действовало только до
 * сегодняшнего дня, а промежуточные значения, которые прокручивались шагами «+» и «−», в
 * историю не попадают. Вернул то, что было утром, — запись просто исчезает.
 */
export function changeDayRule(current: DayRule, next: DayRule, today: string): DayRule {
  const before = coreOf(current);
  const after = coreOf(next);
  const eras = [...(current.history ?? [])];
  if (sameRule(before, after)) return withHistory(before, eras);

  const last = eras[eras.length - 1];
  if (!last || last.until < today) {
    eras.push({ until: today, rule: before });
  } else if (last.until === today && sameRule(last.rule, after)) {
    // Вернулись к тому, что было до сегодняшней смены, — смены как не было.
    eras.pop();
  }
  return withHistory(after, eras);
}

/**
 * «До такого-то дня действовало вот это правило» — для того, что было сменено раньше, чем
 * приложение стало помнить смены.
 *
 * Без неё у уже набранной истории не было бы способа исправиться: правило записано одно, и
 * когда оно менялось, приложение не знало. Записи с датой не позже этой заменяются: человек
 * только что сказал, что там было, и это новее догадки. Более поздние остаются как были.
 * Дата не может быть из будущего — иначе старое правило судило бы и сегодня.
 */
export function withPastRule(current: DayRule, until: string, old: DayRule, today: string): DayRule {
  const when = until > today ? today : until;
  const later = (current.history ?? []).filter((e) => e.until > when);
  const eras = normalizeEras([{ until: when, rule: coreOf(old) }, ...later]);
  return withHistory(coreOf(current), eras);
}

/**
 * How many of the day's deciding habits have to be closed.
 *
 * Both variable rules are clamped to the size of the pile itself: asking for five habits out
 * of a list of three is a day that can never be closed, and a bar nothing can clear is worse
 * than no bar. Never below one either — a rule that counts an untouched day is not a rule.
 */
export function requiredForDay(rule: DayRuleCore, decidingCount: number): number {
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
export function describeDayRule(rule: DayRuleCore, decidingCount: number): string {
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
