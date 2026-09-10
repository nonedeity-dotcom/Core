import type { HourlyValue } from "./sessions";
import { subtractHourly } from "./sessions";

/**
 * Почасовая картина одного дня — то, что система помнит лишь несколько суток.
 *
 * Подробные события Android держит считанные дни, и раньше почасовой график существовал
 * ровно для них: открыл вчерашний день — картинка есть, открыл двадцатое августа — нет
 * ничего, хотя итог за тот день лежит в истории и никуда не денется. Теперь разбивка
 * считается один раз, пока события ещё живы, и сохраняется рядом с итогом: события
 * состарятся, а картинка дня останется.
 *
 * Хранятся общие ряды, а не каждое приложение по часам. Приложений за день набирается
 * под сорок, и почасовая история по каждому весила бы в разы больше всей остальной, ради
 * экрана одного приложения за давно прошедший день. Общие ряды — те, что рисует главный
 * экран, — стоят около полукилобайта на день: вся история за пару лет умещается в треть
 * мегабайта.
 */
export interface HourlyDay {
  date: string;
  /** Экран включён — без экрана блокировки. 24 числа, миллисекунды. */
  screen: number[];
  /** Приложения на переднем плане, кроме домашнего экрана. 24 числа, миллисекунды. */
  apps: number[];
  /** Заходы в приложения, кроме домашнего экрана. 24 числа. */
  launches: number[];
  /** Разблокировки. 24 числа. */
  unlocks: number[];
}

export const HOURS = 24;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ряд из хранилища: чужой длины, дробей и мусора внутри быть не должно. */
function series(value: unknown): number[] {
  const out = new Array<number>(HOURS).fill(0);
  if (!Array.isArray(value)) return out;
  for (let hour = 0; hour < HOURS; hour++) {
    const v = value[hour];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[hour] = Math.round(v);
  }
  return out;
}

export function normalizeHourlyDay(value: unknown): HourlyDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string" || !DATE_RE.test(v.date)) return null;
  return {
    date: v.date,
    screen: series(v.screen),
    apps: series(v.apps),
    launches: series(v.launches),
    unlocks: series(v.unlocks),
  };
}

/** Пустой день — все ряды нулевые. Такой день хранить незачем. */
export function isEmptyHourlyDay(day: HourlyDay): boolean {
  return [day.screen, day.apps, day.launches, day.unlocks].every((row) => row.every((v) => v === 0));
}

const toValues = (row: number[]): HourlyValue[] => row.map((value, hour) => ({ hour, value }));

const addHourly = (a: number[], b: number[]): number[] => a.map((v, i) => v + (b[i] ?? 0));

/**
 * Ряд для графика: та же арифметика, что и у чисел над ним.
 *
 * «Телефон» — это вычитание: всё экранное время минус то, что забрали приложения. «Общий»
 * по заходам — сумма заходов в приложения и разблокировок, ровно как в крупном числе.
 * Считать здесь по-своему значило бы показать на одном экране два разных ответа.
 */
export function seriesFor(
  day: HourlyDay,
  scope: "all" | "apps" | "phone",
  metric: "time" | "launches",
): HourlyValue[] {
  if (metric === "launches") {
    if (scope === "apps") return toValues(day.launches);
    if (scope === "phone") return toValues(day.unlocks);
    return toValues(addHourly(day.launches, day.unlocks));
  }
  if (scope === "apps") return toValues(day.apps);
  if (scope === "all") return toValues(day.screen);
  return subtractHourly(toValues(day.screen), toValues(day.apps));
}
