import type { Habit, HabitLog } from "../types";
import { dayProgress, habitGroup } from "./habits";

/**
 * Что показывает виджет на рабочем столе и что из него приходит обратно.
 *
 * Виджет не умеет читать хранилище приложения: оно живёт внутри JS. Поэтому приложение
 * отдаёт ему готовый слепок «сегодня», а он копит нажатия, пока приложение закрыто. Здесь
 * обе стороны — чистые функции, без телефона.
 */

export interface WidgetSub {
  id: string;
  label: string;
  done: boolean;
}

export interface WidgetHabit {
  id: string;
  label: string;
  count: number;
  target: number;
  /** Отмечается сама (экранное время). */
  auto: boolean;
  /** Подзадачи: только у родителя, у обычной привычки пусто. */
  subs: WidgetSub[];
}

export interface WidgetSnapshot {
  date: string;
  habits: WidgetHabit[];
}

/** Одно нажатие на виджете: какая привычка и в какой день. */
export interface WidgetTap {
  id: string;
  date: string;
}

/**
 * Слепок: только «Ввожу сейчас» — то, по чему засчитывается день.
 *
 * «Дополнительно» и «Потом» на рабочий стол не выносятся: виджет, в котором двадцать строк,
 * перестаёт быть тем, на что смотришь мимоходом, а «потом» и в приложении не отмечается.
 */
export function widgetSnapshot(habits: Habit[], logs: HabitLog[], today: string): WidgetSnapshot {
  const live = habits.filter((h) => !h.archivedAt);
  const subsOf = (parentId: string): WidgetSub[] =>
    live
      .filter((s) => s.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, label: s.label, done: logs.find((l) => l.habitId === s.id)?.done ?? false }));

  return {
    date: today,
    habits: live
      .filter((h) => !h.parentId && habitGroup(h) === "now")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((h) => {
        const subs = h.hasSubtasks ? subsOf(h.id) : [];
        if (subs.length > 0) {
          // У родителя с подзадачами «сколько сделано» — это подзадачи, как в приложении.
          const done = subs.filter((s) => s.done).length;
          return { id: h.id, label: h.label, count: done, target: subs.length, auto: false, subs };
        }
        const { count, target } = dayProgress(h, logs, today);
        return { id: h.id, label: h.label, count: Math.min(count, target), target, auto: h.auto === "screentime", subs: [] };
      }),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Очередь нажатий, как её отдал телефон. Всё непонятное выбрасывается, а не роняет запуск. */
export function parseTaps(raw: string): WidgetTap[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(
    (t): t is WidgetTap =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as WidgetTap).id === "string" &&
      (t as WidgetTap).id.length > 0 &&
      typeof (t as WidgetTap).date === "string" &&
      DATE_RE.test((t as WidgetTap).date),
  );
}

/**
 * Какие нажатия применить.
 *
 * Только к привычкам, которые ещё есть и которые можно отметить пальцем: пока телефон лежал,
 * привычку могли удалить или сделать экранной, и нажатие на неё — уже нажатие в пустоту.
 */
export function tapsToApply(taps: WidgetTap[], habits: Habit[]): { habit: Habit; date: string }[] {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const out: { habit: Habit; date: string }[] = [];
  for (const t of taps) {
    const habit = byId.get(t.id);
    if (!habit || habit.archivedAt || habit.auto === "screentime") continue;
    out.push({ habit, date: t.date });
  }
  return out;
}
