import { dateNDaysAgo } from "./date";
import { plural } from "./plural";
import { dayOfWeek } from "./week";

/**
 * Выходной — день, который не рвёт серию и не тратит шанс.
 *
 * Это третья вещь после «сделал» и «пропустил», и путать её ни с одной из них нельзя.
 * Пропуск — это промах, за него платят шансом из запаса, и два подряд не прощаются никогда.
 * Выходной промахом не является: он объявлен заранее, платить за него нечем и незачем, и
 * подряд их может быть сколько угодно — отпуск не обязан укладываться в один день.
 *
 * В серию выходной не идёт. Серия считает дни, которые человек действительно сделал, и
 * прибавлять к ней дни отдыха значило бы считать отдых работой: поставил выходным каждое
 * воскресенье — и число растёт само по себе, ничего не измеряя. Серия его перешагивает.
 *
 * Модуль ничего не знает ни про хранилище, ни про экраны: на входе дата и правило, на
 * выходе ответ.
 */

export interface DayOffRule {
  /**
   * Постоянные выходные: дни недели, понедельник — 1, воскресенье — 7.
   *
   * Номера, а не даты: «каждое воскресенье» не должно требовать отмечать пятьдесят две
   * галочки в год и заканчиваться в декабре.
   */
  weekdays: number[];
  /** Разовые: конкретные даты, "yyyy-MM-dd". Отпуск, болезнь, поездка. */
  dates: string[];
}

export const DEFAULT_DAY_OFF: DayOffRule = { weekdays: [], dates: [] };

/** Понедельник первым — так же, как неделя считается во всём остальном приложении. */
export const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const WEEKDAY_FULL = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];

/**
 * Насколько далеко назад можно объявить день выходным.
 *
 * Вчера — и не дальше. Выходной планируют, а не подбирают задним числом под уже
 * случившийся провал: иначе серию можно переписать в любой момент, и она перестаёт
 * что-либо значить. Вчера оставлено потому, что отметить вечером забывают, а утром
 * вспоминают, — и это всё ещё про тот день, который человек помнит.
 */
export const earliestMarkable = (today: string): string => {
  void today;
  return dateNDaysAgo(1);
};

export function canMark(date: string, today: string): boolean {
  return date >= earliestMarkable(today);
}

const isDateKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function normalizeDayOff(value: unknown): DayOffRule {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_DAY_OFF };
  const o = value as Record<string, unknown>;
  const weekdays = Array.isArray(o.weekdays)
    ? [...new Set(o.weekdays.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7))].sort(
        (a, b) => a - b,
      )
    : [];
  const dates = Array.isArray(o.dates) ? [...new Set(o.dates.filter(isDateKey))].sort() : [];
  return { weekdays, dates };
}

/** Выходной ли этот день — по любой из двух причин. */
export function isDayOff(date: string, rule: DayOffRule): boolean {
  return rule.dates.includes(date) || rule.weekdays.includes(dayOfWeek(date));
}

/**
 * Почему именно он выходной — это разные вещи для экрана.
 *
 * Постоянный снимается переключателем дня недели, разовый — той же кнопкой, которой
 * ставился. Показать «убрать выходной» там, где кнопка ничего не уберёт, значит соврать.
 */
export type DayOffReason = "weekday" | "date" | null;

export function dayOffReason(date: string, rule: DayOffRule): DayOffReason {
  if (rule.dates.includes(date)) return "date";
  if (rule.weekdays.includes(dayOfWeek(date))) return "weekday";
  return null;
}

/** Поставить или снять разовый выходной. Постоянных не касается. */
export function toggleDate(rule: DayOffRule, date: string): DayOffRule {
  const has = rule.dates.includes(date);
  return {
    weekdays: [...rule.weekdays],
    dates: has ? rule.dates.filter((d) => d !== date) : [...rule.dates, date].sort(),
  };
}

/** Включить или выключить постоянный выходной по дню недели. */
export function toggleWeekday(rule: DayOffRule, weekday: number): DayOffRule {
  if (weekday < 1 || weekday > 7) return rule;
  const has = rule.weekdays.includes(weekday);
  return {
    weekdays: (has ? rule.weekdays.filter((d) => d !== weekday) : [...rule.weekdays, weekday]).sort(
      (a, b) => a - b,
    ),
    dates: [...rule.dates],
  };
}

/**
 * Разовые выходные старше окна серии держать незачем.
 *
 * Список, который только растёт, однажды станет тысячей строк, ни одна из которых ни на что
 * не влияет: серия дальше своего окна не смотрит.
 */
export function pruneDates(rule: DayOffRule, windowDays: number): DayOffRule {
  const oldest = dateNDaysAgo(windowDays);
  return { weekdays: [...rule.weekdays], dates: rule.dates.filter((d) => d >= oldest) };
}

/** Правило словами — для карточки настройки. */
export function describeDayOff(rule: DayOffRule): string {
  if (rule.weekdays.length === 0 && rule.dates.length === 0) return "Не назначены";
  const parts: string[] = [];
  if (rule.weekdays.length === 7) parts.push("каждый день");
  else if (rule.weekdays.length > 0) {
    parts.push(`каждый ${rule.weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(", ")}`);
  }
  if (rule.dates.length > 0) {
    const n = rule.dates.length;
    parts.push(`${parts.length > 0 ? "и ещё " : ""}${n} ${plural(n, ["день", "дня", "дней"])} отдельно`);
  }
  return parts.join(" ");
}
