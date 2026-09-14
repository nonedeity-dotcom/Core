import { dateNDaysAgo } from "./date";
import { DEFAULT_DAY_RULE, requiredForDay, type DayRule } from "./dayRule";
import { DEFAULT_SKIP_RULE, periodBucket, type SkipRule } from "./skipRule";
import { DEFAULT_DAY_OFF, isDayOff, type DayOffRule } from "./dayOff";
import { habitsThatDecideTheDay, logCount, perDayTarget } from "./habits";
import type { Habit, HabitLog } from "../types";

/** How far back a streak is counted — comfortably past the 66-day mark. */
export const STREAK_WINDOW_DAYS = 120;

/**
 * Whether a single day met the bar: every habit that was in the "now" pile *on that day*
 * reached its target for it.
 *
 * It used to be "half of all habits", which is why a list of ten things you eventually want
 * made the bar ten tall and then let you clear it with five. The bar is now exactly as tall
 * as the pile you said you are working on — which is what makes keeping that pile small the
 * point rather than a suggestion.
 *
 * "Дополнительно" and "потом" cannot fail a day, and neither can a weekly habit: it would
 * fail every day that isn't a training day. No daily habit in the "now" pile means there is
 * no verdict to give and the day does not count — the same rule as an empty checklist,
 * which once reported a 120-day streak for nothing at all.
 */
export function dayCounts(
  habits: Habit[],
  logs: HabitLog[],
  date: string,
  rule: DayRule = DEFAULT_DAY_RULE,
): boolean {
  return dayCountsWith(habits, logs, date, startsByHabit(habits, logs), rule);
}

/**
 * When each habit started deciding days.
 *
 * `createdAt` is the answer whenever it is there. When it is not — a row written before the
 * field existed and not yet migrated, or one that arrived through a merge from an old
 * backup — the first day the habit was actually marked is the next best evidence the device
 * has, and it is the same rule the migration itself uses. A habit with neither is left out
 * of the map entirely, which makes it decide nothing until it has a history.
 */
export function startsByHabit(habits: Habit[], logs: HabitLog[]): Map<string, string> {
  const starts = new Map<string, string>();
  for (const h of habits) if (h.createdAt) starts.set(h.id, h.createdAt);

  const firstMarks = new Map<string, string>();
  for (const l of logs) {
    if (!l.done || starts.has(l.habitId)) continue;
    const seen = firstMarks.get(l.habitId);
    if (seen === undefined || l.date < seen) firstMarks.set(l.habitId, l.date);
  }
  for (const [id, first] of firstMarks) starts.set(id, first);
  return starts;
}

function dayCountsWith(
  habits: Habit[],
  logs: HabitLog[],
  date: string,
  starts: Map<string, string>,
  rule: DayRule,
): boolean {
  const deciding = habitsThatDecideTheDay(habits, date, starts);
  if (deciding.length === 0) return false;
  const counts = new Map<string, number>();
  for (const l of logs) if (l.date === date) counts.set(l.habitId, logCount(l));
  return meetsDay(deciding, counts, rule);
}

/**
 * The rule itself, so the single-day and whole-history callers cannot drift apart.
 *
 * How many have to be closed is [requiredForDay]; *which* ones is deliberately not asked.
 * A rule of "three of five" that also named the three would be a different, longer list of
 * habits rather than a lighter bar over the same one.
 */
function meetsDay(deciding: Habit[], counts: Map<string, number>, rule: DayRule): boolean {
  const closed = deciding.filter((h) => (counts.get(h.id) ?? 0) >= perDayTarget(h)).length;
  return closed >= requiredForDay(rule, deciding.length);
}

/**
 * Every date that counted, in one pass.
 *
 * The statistics screen asks about a year at a time; calling dayCounts per day would
 * re-scan the whole log for each one. Same verdict, one walk.
 */
export function countedDates(
  habits: Habit[],
  logs: HabitLog[],
  rule: DayRule = DEFAULT_DAY_RULE,
): Set<string> {
  const counted = new Set<string>();
  if (habitsThatDecideTheDay(habits).length === 0) return counted;

  const starts = startsByHabit(habits, logs);
  const byDate = new Map<string, Map<string, number>>();
  for (const l of logs) {
    let day = byDate.get(l.date);
    if (!day) {
      day = new Map();
      byDate.set(l.date, day);
    }
    // Two rows for one habit on one day shouldn't halve its count.
    day.set(l.habitId, Math.max(day.get(l.habitId) ?? 0, logCount(l)));
  }
  // The deciding set is per date, not per call: a habit added last week does not get a say
  // in the week before it.
  for (const [date, counts] of byDate) {
    const deciding = habitsThatDecideTheDay(habits, date, starts);
    if (deciding.length > 0 && meetsDay(deciding, counts, rule)) counted.add(date);
  }
  return counted;
}

/**
 * Days in a row that counted.
 *
 * Lives here rather than inside the report because three screens read it now, and a second
 * hand-rolled copy would drift: "deleted habits don't count" and "an empty checklist has no
 * streak" are both bugs that were fixed once already.
 */
export function computeStreak(
  habits: Habit[],
  logs: HabitLog[],
  frozen: string[] = [],
  rule: DayRule = DEFAULT_DAY_RULE,
  daysOff: DayOffRule = DEFAULT_DAY_OFF,
): number {
  // With nothing in the "now" pile there is nothing to be consistent about.
  if (habitsThatDecideTheDay(habits).length === 0) return 0;

  const frozenDays = new Set(frozen);
  // Built once: dayCounts would otherwise re-derive it for each of 120 days.
  const starts = startsByHabit(habits, logs);

  let streak = 0;
  for (let i = 0; i < STREAK_WINDOW_DAYS; i++) {
    const day = dateNDaysAgo(i);
    if (dayCountsWith(habits, logs, day, starts, rule)) streak++;
    // Today still being unfinished shouldn't break yesterday's streak.
    else if (i === 0) continue;
    // A frozen day neither breaks the chain nor adds to it. Counting it as a day would be
    // a lie about how many days were actually done; breaking on it is the cliff the freeze
    // exists to remove.
    else if (frozenDays.has(day)) continue;
    // Выходной ведёт себя так же, как потраченный шанс: цепочку не рвёт и не удлиняет.
    // Разница только в цене — за него ничего не платят.
    else if (isDayOff(day, daysOff)) continue;
    else break;
  }
  return streak;
}

/**
 * Сколько календарных дней идёт нынешняя цепочка — считая пропуски и выходные.
 *
 * Серия и длина цепочки — разные числа, и оба нужны. Серия считает дни, которые
 * действительно сделаны: это честная мера работы, и прибавлять к ней отдых значило бы
 * считать отдых работой. Но «держусь седьмую неделю» — тоже правда, и по одной серии её не
 * увидеть: цепочка с двумя выходными и потраченным шансом идёт дольше, чем говорит её
 * счётчик.
 *
 * Границы берутся по сделанным дням, а не по краю окна: хвост из выходных в конце длину не
 * надувает. Цепочка тянется от первого сделанного дня до последнего, а пропуски и выходные
 * внутри неё считаются отдельно — из них и складывается разница между двумя числами.
 */
export interface StreakSpan {
  /** Календарных дней от первого сделанного дня цепочки до последнего. */
  days: number;
  /** Из них сделано — то же число, что показывает серия. */
  done: number;
  /** Прощено шансом. */
  frozen: number;
  /** Выходных внутри цепочки. */
  off: number;
}

export function streakSpan(
  habits: Habit[],
  logs: HabitLog[],
  frozen: string[] = [],
  rule: DayRule = DEFAULT_DAY_RULE,
  daysOff: DayOffRule = DEFAULT_DAY_OFF,
): StreakSpan {
  const empty: StreakSpan = { days: 0, done: 0, frozen: 0, off: 0 };
  if (habitsThatDecideTheDay(habits).length === 0) return empty;

  const frozenDays = new Set(frozen);
  const starts = startsByHabit(habits, logs);

  let done = 0;
  let insideFrozen = 0;
  let insideOff = 0;
  // Смещения первого и последнего сделанного дня — ими и меряется длина.
  let newest = -1;
  let oldest = -1;
  // Пропуски и выходные, встреченные после последнего сделанного дня: пока за ними не
  // нашлось ни одного сделанного, они висят на хвосте и в длину не идут.
  let pendingFrozen = 0;
  let pendingOff = 0;

  for (let i = 0; i < STREAK_WINDOW_DAYS; i++) {
    const day = dateNDaysAgo(i);
    if (dayCountsWith(habits, logs, day, starts, rule)) {
      done++;
      oldest = i;
      if (newest === -1) {
        // Первый встреченный сделанный день — правый край цепочки. Всё, что копилось до
        // него, лежит новее края: это хвост, он и в длину не идёт, и в счётчики не должен.
        newest = i;
      } else {
        // А это уже промежуток между двумя сделанными днями — он внутри цепочки.
        insideFrozen += pendingFrozen;
        insideOff += pendingOff;
      }
      pendingFrozen = 0;
      pendingOff = 0;
      continue;
    }
    if (i === 0) continue;
    if (frozenDays.has(day)) {
      pendingFrozen++;
      continue;
    }
    if (isDayOff(day, daysOff)) {
      pendingOff++;
      continue;
    }
    break;
  }

  if (newest === -1) return empty;
  return { days: oldest - newest + 1, done, frozen: insideFrozen, off: insideOff };
}

/**
 * How much of the skip budget the current run has already spent.
 *
 * For a calendar period that is simply "the frozen days in the same week/month". For "за всю
 * цепочку" there is no calendar bucket: the budget belongs to the run, so this walks back
 * from `from` counting frozen days and stops at the first day that genuinely failed — that
 * day is where the previous chain ended and where the budget was last refilled.
 */
function skipsUsed(
  habits: Habit[],
  logs: HabitLog[],
  frozenDays: Set<string>,
  dayRule: DayRule,
  rule: SkipRule,
  daysOff: DayOffRule,
  candidate: string,
  from: number,
): number {
  const bucket = periodBucket(candidate, rule.shared.period);
  if (bucket !== null) {
    let used = 0;
    for (const day of frozenDays) if (periodBucket(day, rule.shared.period) === bucket) used++;
    return used;
  }

  let used = 0;
  for (let i = from; i < STREAK_WINDOW_DAYS; i++) {
    const day = dateNDaysAgo(i);
    if (frozenDays.has(day)) {
      used++;
      continue;
    }
    // Выходной запаса не тратил и цепочку не обрывал — проходим мимо.
    if (isDayOff(day, daysOff)) continue;
    // A day that actually held keeps the run going; one that failed unfrozen ended it, and
    // everything before it belongs to a chain that is already over.
    if (!dayCounts(habits, logs, day, dayRule)) break;
  }
  return used;
}

/**
 * The day that should be frozen right now, or null.
 *
 * Only ever yesterday, and only when there was a chain to protect: a gap older than that has
 * already broken the streak, and rescuing it retroactively would mean the number changed
 * under someone who had already seen it.
 *
 * Never two days running, whatever the budget says. A second day off is not a slip, and a
 * chain that survives an open-ended gap has stopped measuring anything — so the day before
 * yesterday having been frozen rules yesterday out on its own.
 */
export function freezeCandidate(
  habits: Habit[],
  logs: HabitLog[],
  frozen: string[],
  today: string,
  dayRule: DayRule = DEFAULT_DAY_RULE,
  rule: SkipRule = DEFAULT_SKIP_RULE,
  daysOff: DayOffRule = DEFAULT_DAY_OFF,
): string | null {
  if (habits.length === 0) return null;
  // Общий запас держит день; запас на каждую привычку — её собственную серию, и сюда он
  // отношения не имеет. Раньше здесь стояло «режим не общий — выходим», и именно из-за
  // этого день оставался без защиты у всех, кто выбрал шансы на привычки.
  if (rule.shared.count <= 0) return null;

  const yesterday = dateNDaysAgo(1);
  if (dayCounts(habits, logs, yesterday, dayRule)) return null;
  // Вчера было выходным — спасать нечего и платить не за что.
  if (isDayOff(yesterday, daysOff)) return null;

  const frozenDays = new Set(frozen);
  if (frozenDays.has(yesterday)) return null;

  // Предыдущий день, который вообще о чём-то говорит: выходные пропускаем. Иначе
  // постоянный выходной по воскресеньям означал бы, что понедельник никогда не прикрыть —
  // «позавчера ничего не сделано», хотя позавчера и не требовалось.
  let i = 2;
  while (i < STREAK_WINDOW_DAYS && isDayOff(dateNDaysAgo(i), daysOff)) i++;
  const previous = dateNDaysAgo(i);

  // Two in a row is a real break — this is the rule the budget cannot buy its way past.
  // Выходные в эту пару не считаются: отдых по расписанию промахом не является.
  if (frozenDays.has(previous)) return null;
  // Nothing to save: the chain was already broken the day before.
  if (!dayCounts(habits, logs, previous, dayRule)) return null;

  if (skipsUsed(habits, logs, frozenDays, dayRule, rule, daysOff, yesterday, i) >= rule.shared.count) {
    return null;
  }

  return yesterday;
}
