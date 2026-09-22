import { dayOfWeek } from "../week";
import { isDayOff, type DayOffRule } from "../dayOff";
import { shiftDate, daysBetween } from "../date";

/**
 * Год клетками.
 *
 * Ни одно число не показывает того, что показывает эта решётка: где были провалы, сколько
 * они длились и что случилось после них. «Лучшая серия 34» и «закрыто 128 дней» одинаково
 * звучат и у того, кто держался всю зиму и сорвался весной, и у того, кто дёргается через
 * день, — а на клетках это два разных рисунка, и разницу видно, не читая.
 *
 * Модуль ничего не знает ни про экраны, ни про хранилище: на входе даты и правила, на
 * выходе — колонки недель и подписи месяцев.
 */

/** Чем день был. Порядок важен: он же и порядок проверок. */
export type DayMark =
  /** День закрыт — то, ради чего всё. */
  | "closed"
  /** Заморозка: пропуск, оплаченный шансом из запаса. */
  | "frozen"
  /** Объявленный выходной — не промах и не заслуга. */
  | "off"
  /** Промах. */
  | "missed"
  /** Сегодня: день ещё идёт, и называть его промахом рано. */
  | "today"
  /** До первой отметки вообще — приложения тогда ещё не было в твоей жизни. */
  | "before"
  /** Впереди. Клетка есть только чтобы неделя была полной. */
  | "future";

export interface YearDay {
  date: string;
  mark: DayMark;
}

export interface MonthLabel {
  /** Номер колонки, над которой стоит подпись. */
  column: number;
  label: string;
}

export interface YearGrid {
  /** Колонки по неделям, слева направо; внутри колонки — с понедельника по воскресенье. */
  weeks: YearDay[][];
  months: MonthLabel[];
  /** Сколько клеток каждого вида — для подписи под решёткой. */
  counts: Record<DayMark, number>;
}

export const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/** Сколько недель показывать. Год с небольшим — чтобы правый край не упирался в январь. */
export const WEEKS = 53;

export interface YearInput {
  today: string;
  closed: Set<string>;
  frozen: Set<string>;
  daysOff: DayOffRule;
  /** Первая отметка вообще. `null` — истории ещё нет, и вся решётка пустая. */
  since: string | null;
  weeks?: number;
}

/**
 * Решётка, у которой правый столбец — текущая неделя.
 *
 * Считается от воскресенья этой недели назад, а не от «год назад до сегодня»: иначе
 * столбцы разъезжаются по дням недели, и строка «понедельник» перестаёт быть строкой
 * понедельников.
 */
export function yearGrid({ today, closed, frozen, daysOff, since, weeks = WEEKS }: YearInput): YearGrid {
  // Воскресенье текущей недели: dayOfWeek — 1 у понедельника, 7 у воскресенья.
  const end = shiftDate(today, 7 - dayOfWeek(today));
  const start = shiftDate(end, -(weeks * 7 - 1));

  const counts: Record<DayMark, number> = {
    closed: 0,
    frozen: 0,
    off: 0,
    missed: 0,
    today: 0,
    before: 0,
    future: 0,
  };

  const columns: YearDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: YearDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(start, w * 7 + d);
      const mark = markOf(date, { today, closed, frozen, daysOff, since });
      counts[mark] += 1;
      column.push({ date, mark });
    }
    columns.push(column);
  }

  return { weeks: columns, months: monthLabels(columns), counts };
}

function markOf(
  date: string,
  { today, closed, frozen, daysOff, since }: Omit<YearInput, "weeks">,
): DayMark {
  if (date > today) return "future";
  if (since === null || date < since) return "before";
  if (closed.has(date)) return "closed";
  if (date === today) return "today";
  if (frozen.has(date)) return "frozen";
  if (isDayOff(date, daysOff)) return "off";
  return "missed";
}

/**
 * Подписи месяцев над колонками.
 *
 * Подписывается та колонка, в которую попало первое число месяца, — и искать надо именно
 * первое число, а не месяц первого дня колонки. Сначала было второе: месяц объявлялся
 * сменившимся по понедельнику, и почти все подписи терялись, потому что месяцы начинаются
 * посреди недели.
 *
 * У правого края подписи нет: ей некуда вытянуться, и она налезла бы на соседнюю.
 */
function monthLabels(columns: YearDay[][]): MonthLabel[] {
  const out: MonthLabel[] = [];
  columns.forEach((column, index) => {
    const first = column.find((d) => d.date.endsWith("-01"));
    if (!first || index > columns.length - 3) return;
    out.push({ column: index, label: MONTHS_SHORT[Number(first.date.slice(5, 7)) - 1] });
  });
  return out;
}

/**
 * Сколько дней прошло с первой отметки, считая её саму.
 *
 * Не то же самое, что закрытых дней, и в этом вся суть двух чисел рядом: одно говорит,
 * сколько ты здесь, второе — сколько из них получилось.
 */
export const daysSince = (since: string | null, today: string): number =>
  since === null ? 0 : Math.max(0, daysBetween(since, today) + 1);
