import { daysBetween, shiftDate, todayKey } from "../date";

/**
 * Период, за который показывается статистика.
 *
 * Перенесено из creker (`core/StatsPeriod.kt`). Различие пресета и зафиксированного
 * диапазона — не украшение: пресет пересчитывается от «сегодня» каждый раз, поэтому
 * приложение, оставленное открытым через полночь, не показывает вчерашний день как
 * сегодняшний. Диапазон, который человек пролистал или выбрал руками, наоборот, обязан
 * остаться там, куда его поставили.
 */

/** Включительный диапазон календарных дней, ключами "yyyy-MM-dd". */
export interface DayRange {
  from: string;
  to: string;
}

export function dayCount(range: DayRange): number {
  return daysBetween(range.from, range.to) + 1;
}

/** Сдвигает оба конца на одинаковое число дней — шаг по истории целым окном. */
export function shiftRange(range: DayRange, days: number): DayRange {
  return { from: shiftDate(range.from, days), to: shiftDate(range.to, days) };
}

export type Preset = "day" | "yesterday" | "week" | "month";

export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;

export const PRESET_LABELS: Record<Preset, string> = {
  day: "Сегодня",
  yesterday: "Вчера",
  week: "Неделя",
  month: "Месяц",
};

export function resolvePreset(preset: Preset, today = todayKey()): DayRange {
  switch (preset) {
    case "day":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDate(today, -1);
      return { from: y, to: y };
    }
    case "week":
      return { from: shiftDate(today, -(WEEK_DAYS - 1)), to: today };
    case "month":
      return { from: shiftDate(today, -(MONTH_DAYS - 1)), to: today };
  }
}

/** Что сейчас показывает выбор периода: пресет или конкретный диапазон. */
export type Selection = { kind: "preset"; preset: Preset } | { kind: "fixed"; range: DayRange };

export function resolveSelection(selection: Selection, today = todayKey()): DayRange {
  return selection.kind === "preset" ? resolvePreset(selection.preset, today) : selection.range;
}

/** Как назвать диапазон в заголовке. */
export function describeRange(range: DayRange, today = todayKey()): string {
  if (range.from === range.to) {
    if (range.from === today) return "Сегодня";
    if (range.from === shiftDate(today, -1)) return "Вчера";
    return formatDay(range.from);
  }
  return `${formatDay(range.from)} — ${formatDay(range.to)}`;
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/**
 * День словом, а не цифрами: «29 авг», а не «29.08».
 *
 * Точка между числами читается как разделитель, и «20.08 — 05.09» глаз разбирает дважды:
 * сперва на четыре числа, потом на две даты. Месяц словом снимает эту работу — и заодно
 * убирает вопрос, где здесь день, а где месяц.
 */
function formatDay(key: string): string {
  const [, m, d] = key.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${Number(d)} ${month}`;
}
