import { daysBetween, todayKey } from "../date";

/**
 * Дневник веса — то, чего CaloriX не хватало, чтобы быть чем-то, кроме журнала.
 *
 * Норма считается по формуле, а формула выведена на выборке, а не на этом человеке. Узнать,
 * подходит ли она, можно ровно одним способом: смотреть, что делает вес при известном
 * питании. Средние калории без веса — это «я ем 1900»; средние калории рядом с весом — это
 * «я ем 1900, и вес стоит», а из второго уже понятно, что делать.
 */

export interface WeightEntry {
  /** Ключ дня, "yyyy-MM-dd". Один вес на день: перевзвесился — запись заменяется. */
  date: string;
  kg: number;
}

/** Границы, за которыми число перестаёт быть весом человека. Те же, что в профиле. */
export const WEIGHT_LIMITS = { min: 30, max: 250 };

/** Сколько дней истории веса имеет смысл держать и читать. */
export const WEIGHT_WINDOW_DAYS = 400;

export function normalizeWeightEntry(value: unknown): WeightEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (typeof v.kg !== "number" || !Number.isFinite(v.kg)) return null;
  if (v.kg < WEIGHT_LIMITS.min || v.kg > WEIGHT_LIMITS.max) return null;
  return { date: v.date, kg: Math.round(v.kg * 10) / 10 };
}

/** Последнее взвешивание — оно же текущий вес, из которого считаются нормы. */
export function latestWeight(log: WeightEntry[]): WeightEntry | null {
  return log.reduce<WeightEntry | null>((best, e) => (!best || e.date > best.date ? e : best), null);
}

export interface WeightTrend {
  /** Средний вес в первой половине окна и во второй. */
  from: number;
  to: number;
  /** Насколько изменился: минус — вес уходит. */
  deltaKg: number;
  /** Тот же сдвиг, пересчитанный на неделю, — в этом виде его и сравнивают с целью. */
  perWeek: number;
  /** Сколько дней между серединами половин: на них и растянут сдвиг. */
  spanDays: number;
  /** Сколько взвешиваний участвовало. Меньше двух — тренда нет. */
  points: number;
}

/**
 * Куда идёт вес за последние `days` дней.
 *
 * Не «первое взвешивание против последнего»: вес за сутки скачет на килограмм от воды, соли
 * и содержимого кишечника, и по двум точкам можно доказать что угодно. Окно делится
 * пополам, каждая половина усредняется, и сравниваются средние — так случайный тяжёлый
 * вторник больше не решает, худеет человек или нет.
 *
 * Меньше двух взвешиваний — возвращается null. Это не ноль и не «вес не меняется»: это
 * «сказать пока нечего», и экран должен говорить именно так.
 */
export function weightTrend(log: WeightEntry[], days: number, today = todayKey()): WeightTrend | null {
  const window = log
    .filter((e) => {
      const back = daysBetween(e.date, today);
      return back >= 0 && back < days;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (window.length < 2) return null;

  const half = Math.floor(window.length / 2);
  // При нечётном числе точек средняя достаётся поздней половине: она ближе к «сейчас», а
  // вопрос всегда про сейчас.
  const early = window.slice(0, half);
  const late = window.slice(half);
  const avg = (xs: WeightEntry[]) => xs.reduce((s, e) => s + e.kg, 0) / xs.length;
  const meanOffset = (xs: WeightEntry[]) => xs.reduce((s, e) => s + daysBetween(e.date, today), 0) / xs.length;

  const from = Math.round(avg(early) * 10) / 10;
  const to = Math.round(avg(late) * 10) / 10;
  const spanDays = Math.round(meanOffset(early) - meanOffset(late));
  const deltaKg = Math.round((to - from) * 10) / 10;
  const perWeek = spanDays > 0 ? Math.round((deltaKg / spanDays) * 7 * 10) / 10 : 0;

  return { from, to, deltaKg, perWeek, spanDays, points: window.length };
}
