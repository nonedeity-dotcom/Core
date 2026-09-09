import { dateNDaysAgo } from "../date";
import { sumNutrition, type FoodEntry, type Nutrition } from "./food";

/**
 * Что видно в дневнике на длинной дистанции.
 *
 * Главное решение здесь — что считать средним. Делить съеденное на все семь календарных
 * дней значит занижать: день без записей это не день без еды, а день без дневника. Поэтому
 * среднее берётся по дням, в которые что-то записано, и рядом всегда стоит, сколько таких
 * дней было. «2100 ккал за 5 дней из 7» — это правда; «1500 ккал за неделю» — нет.
 */

export interface PeriodStats {
  /** Сколько дней периода вообще имеют записи. */
  daysLogged: number;
  /** Длина периода в днях. */
  days: number;
  /** Средние за дни с записями. Нули, когда записей нет вообще. */
  average: Nutrition;
}

/** Даты, в которые есть хоть одна запись. */
export function loggedDates(entries: FoodEntry[]): Set<string> {
  return new Set(entries.map((e) => e.date));
}

export function periodStats(entries: FoodEntry[], days: number): PeriodStats {
  const window = new Set(Array.from({ length: days }, (_, i) => dateNDaysAgo(i)));
  const inWindow = entries.filter((e) => window.has(e.date));
  const logged = loggedDates(inWindow);
  if (logged.size === 0) {
    return { daysLogged: 0, days, average: { kcal: 0, protein: 0, fat: 0, carb: 0 } };
  }
  const total = sumNutrition(inWindow);
  const n = logged.size;
  return {
    daysLogged: n,
    days,
    average: {
      kcal: Math.round(total.kcal / n),
      protein: Math.round((total.protein / n) * 10) / 10,
      fat: Math.round((total.fat / n) * 10) / 10,
      carb: Math.round((total.carb / n) * 10) / 10,
    },
  };
}

/** Как далеко назад имеет смысл идти за серией — тот же горизонт, что у привычек. */
export const DIARY_WINDOW_DAYS = 120;

/**
 * Дней подряд, в которые дневник вёлся.
 *
 * Сегодня без записей не обрывает серию — день ещё не кончился, и это то же правило, по
 * которому живёт цепочка привычек: сегодняшний день может ещё не присоединиться, но не
 * может её сломать.
 */
export function diaryStreak(entries: FoodEntry[]): number {
  const logged = loggedDates(entries);
  let streak = 0;
  for (let i = 0; i < DIARY_WINDOW_DAYS; i++) {
    const day = dateNDaysAgo(i);
    if (logged.has(day)) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}
