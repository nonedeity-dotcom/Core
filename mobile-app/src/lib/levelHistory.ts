import { normalizeLevelRule, type LevelRule } from "./level";

/**
 * Норма по уровням, которая действовала *до* даты `until` (не включая её).
 *
 * Та же беда, что была у правила дня: норма одна на всю историю, и стоило поставить
 * «две сверхсложные в день» — как все прошлые дни, где их не делали, задним числом
 * проваливались, а серия обнулялась. Судить день надо по норме, которая стояла в этот день.
 *
 * История лежит отдельно от самой нормы и приклеивается к ней при чтении (см.
 * api.getLevelRule): `normalizeLevelRule` не обязан знать про поле, которого раньше не
 * было, и записанная норма остаётся ровно такой, какой была.
 */
export interface LevelEra {
  until: string;
  rule: LevelRule;
}

/** Норма и то, что действовало до неё. Без `history` норма судит все дни. */
export type LevelRuleWithHistory = LevelRule & { history?: LevelEra[] };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Смен столько не бывает; предел нужен только от мусора в хранилище. */
const MAX_ERAS = 100;

/**
 * Одинаковы ли дневные нормы. Недельная в приговор дня не входит, и её смена историю не
 * плодит: по ней нельзя сказать, закрыт ли вторник.
 */
const sameDaily = (a: LevelRule, b: LevelRule) =>
  JSON.stringify(normalizeLevelRule(a).daily) === JSON.stringify(normalizeLevelRule(b).daily);

export function normalizeLevelEras(value: unknown): LevelEra[] {
  if (!Array.isArray(value)) return [];
  // По дате: две записи на один день — это одна, и верна последняя.
  const byDate = new Map<string, LevelEra>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { until, rule } = raw as { until?: unknown; rule?: unknown };
    if (typeof until !== "string" || !DATE_KEY.test(until)) continue;
    if (typeof rule !== "object" || rule === null) continue;
    byDate.set(until, { until, rule: normalizeLevelRule(rule) });
  }
  return [...byDate.values()].sort((a, b) => a.until.localeCompare(b.until)).slice(-MAX_ERAS);
}

/**
 * По какой норме судится этот день: первая смена, случившаяся позже дня, и есть то, что
 * стояло в тот день. Если такой нет — день не старше последней смены, судит нынешняя.
 */
export function levelRuleForDate(rule: LevelRuleWithHistory, date: string): LevelRule {
  for (const era of rule.history ?? []) if (date < era.until) return era.rule;
  return rule;
}

/**
 * Историю после смены нормы с сегодняшнего дня.
 *
 * Старая норма остаётся за все дни до сегодня, новая судит сегодня и дальше. Несколько
 * смен за один день складываются в одну, а возврат к утреннему значению стирает запись.
 */
export function changeLevelHistory(
  history: LevelEra[],
  before: LevelRule,
  after: LevelRule,
  today: string,
): LevelEra[] {
  if (sameDaily(before, after)) return history;
  const eras = [...history];
  const last = eras[eras.length - 1];
  if (!last || last.until < today) {
    eras.push({ until: today, rule: normalizeLevelRule(before) });
  } else if (last.until === today && sameDaily(last.rule, after)) {
    eras.pop();
  }
  return eras;
}

/**
 * «До такого-то дня норма была вот такой» — для смен, сделанных раньше, чем приложение
 * стало их помнить. Записи не позже этой даты заменяются, более поздние остаются; дата из
 * будущего упирается в сегодня, иначе старая норма судила бы и сегодняшний день.
 */
export function withPastLevelRule(
  history: LevelEra[],
  until: string,
  old: LevelRule,
  today: string,
): LevelEra[] {
  const when = until > today ? today : until;
  const later = history.filter((e) => e.until > when);
  return normalizeLevelEras([{ until: when, rule: old }, ...later]);
}
