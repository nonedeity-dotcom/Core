import { dateNDaysAgo } from "../src/lib/date";
import type { Habit, HabitLog } from "../src/types";

/**
 * Привычки и отметки для проверок — коротко и без лишнего.
 *
 * Даты задаются через «сколько дней назад», а не числами: серия считается от сегодняшнего
 * дня, и проверка, написанная на конкретный сентябрь, в октябре начала бы врать.
 */
export const ago = (n: number): string => dateNDaysAgo(n);

export const habit = (id: string, extra: Partial<Habit> = {}): Habit =>
  ({ id, label: id, sortOrder: 0, createdAt: ago(365), ...extra }) as Habit;

export const mark = (habitId: string, date: string, count = 1): HabitLog =>
  ({ id: `${habitId}-${date}`, habitId, date, done: count > 0, count }) as HabitLog;

/** Отметки по всем привычкам за дни «n назад». */
export const allDone = (habits: Habit[], daysAgo: number[]): HabitLog[] =>
  daysAgo.flatMap((n) => habits.map((h) => mark(h.id, ago(n))));
