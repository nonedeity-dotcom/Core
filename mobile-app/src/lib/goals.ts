/**
 * Цели на месяц и на год, и итог месяца.
 *
 * Здесь нет ничего, что приложение может посчитать само. Серия, закрытые дни, часы фокуса —
 * это уже есть в «Статистике», и цифра там честная. А «выучить билеты», «не срываться в
 * конце месяца» — этого никакой счётчик не знает, и записать это может только человек.
 *
 * Поэтому цель — текст, а не число: главная строка и список мелких пунктов с галочками.
 * Галочку ставишь сам, и она ничего не считает — она просто помнит за тебя.
 *
 * Модуль чистый: на входе ключ периода и записи, на выходе — записи. Ни хранилища, ни
 * навигации, ни дат «прямо сейчас» — поэтому его можно гонять в node.
 */

/** Месяц («2026-09») или год («2026»). Ключ и есть период. */
export type GoalKind = "month" | "year";

export interface GoalItem {
  id: string;
  text: string;
  done: boolean;
}

export interface PeriodGoal {
  /** «2026-09» для месяца, «2026» для года. */
  period: string;
  kind: GoalKind;
  /** Главная цель — одной строкой. Мелкие пункты живут в items. */
  main: string;
  items: GoalItem[];
  /** Итог: что из этого вышло. Только у месяца; пишется в конце. */
  summary: string;
  /** Локальная дата, когда записан итог. Пустая строка — итога ещё нет. */
  summaryDate: string;
  /** Когда цель последний раз трогали — для истории. */
  updatedAt: string;
}

const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MONTHS_ACC = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const MONTHS_PREP = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

/**
 * За сколько дней до конца месяца пора писать итог.
 *
 * Одно число на «Отчёт» и на напоминание: если строка появляется за два дня, а уведомление
 * приходит за пять, то уведомление зовёт туда, где ещё ничего нет.
 */
export const SUMMARY_LEAD_DAYS = 2;

const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** «2026-09-14» → «2026-09». */
export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** «2026-09-14» → «2026». */
export function yearKey(dateKey: string): string {
  return dateKey.slice(0, 4);
}

/** Какого рода период перед нами — по форме самого ключа. */
export function kindOf(period: string): GoalKind {
  return period.length > 4 ? "month" : "year";
}

/** «2026-09» → «Сентябрь 2026»; «2026» → «2026 год». Заголовок экрана. */
export function periodTitle(period: string): string {
  if (kindOf(period) === "year") return `${period} год`;
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_NOM[m - 1] ?? period} ${y}`;
}

/** «на сентябрь» / «на 2026 год» — то, как период называют в строке-приглашении. */
export function periodAccusative(period: string): string {
  if (kindOf(period) === "year") return `${period} год`;
  const m = Number(period.split("-")[1]);
  return MONTHS_ACC[m - 1] ?? period;
}

/** «из августа» / «из 2025 года» — там, где месяц стоит после предлога родительного падежа. */
export function periodGenitive(period: string): string {
  if (kindOf(period) === "year") return `${period} года`;
  const m = Number(period.split("-")[1]);
  return MONTHS_GEN[m - 1] ?? period;
}

/** «в сентябре» / «в 2026 году» — для итога. */
export function periodPrepositional(period: string): string {
  if (kindOf(period) === "year") return `${period} году`;
  const m = Number(period.split("-")[1]);
  return MONTHS_PREP[m - 1] ?? period;
}

/** Предыдущий месяц: «2026-01» → «2025-12». */
export function prevMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Сколько дней в месяце. День 0 следующего месяца — это последний день этого. */
export function daysInMonth(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Первый и последний день месяца, ключами дат. */
export function monthRange(period: string): { from: string; to: string } {
  return { from: `${period}-01`, to: `${period}-${String(daysInMonth(period)).padStart(2, "0")}` };
}

/** Сколько дней месяца осталось после сегодняшнего. В последний день — ноль. */
export function daysLeftInMonth(today: string): number {
  return daysInMonth(monthKey(today)) - Number(today.slice(8, 10));
}

export function emptyGoal(period: string, today: string): PeriodGoal {
  return {
    period,
    kind: kindOf(period),
    main: "",
    items: [],
    summary: "",
    summaryDate: "",
    updatedAt: today,
  };
}

export function newItem(text: string): GoalItem {
  return { id: uid(), text: text.trim(), done: false };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function normalizeItem(raw: unknown): GoalItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const text = str(o.text).trim();
  if (!text) return null;
  return { id: str(o.id) || uid(), text, done: o.done === true };
}

/** Всё, что пришло из хранилища или из копии, — до той формы, на которую рассчитаны экраны. */
export function normalizeGoal(raw: unknown): PeriodGoal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const period = str(o.period);
  if (!/^\d{4}(-\d{2})?$/.test(period)) return null;
  return {
    period,
    kind: kindOf(period),
    main: str(o.main),
    items: Array.isArray(o.items) ? o.items.map(normalizeItem).filter((i): i is GoalItem => i !== null) : [],
    summary: str(o.summary),
    summaryDate: str(o.summaryDate),
    updatedAt: str(o.updatedAt),
  };
}

export function normalizeGoals(raw: unknown): PeriodGoal[] {
  if (!Array.isArray(raw)) return [];
  const out: PeriodGoal[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const goal = normalizeGoal(item);
    // Один период — одна запись: две записи на сентябрь означают, что один экран
    // всегда показывал бы не ту.
    if (goal && !seen.has(goal.period)) {
      seen.add(goal.period);
      out.push(goal);
    }
  }
  return out;
}

export const findGoal = (goals: PeriodGoal[], period: string): PeriodGoal | null =>
  goals.find((g) => g.period === period) ?? null;

/** Сколько пунктов отмечено. Главная строка сюда не входит: у неё нет галочки. */
export function goalProgress(goal: PeriodGoal | null): { done: number; total: number } {
  if (!goal) return { done: 0, total: 0 };
  return { done: goal.items.filter((i) => i.done).length, total: goal.items.length };
}

/** Есть ли вообще что показывать: пустая запись — это то же самое, что её отсутствие. */
export function hasContent(goal: PeriodGoal | null): boolean {
  return !!goal && (goal.main.trim().length > 0 || goal.items.length > 0);
}

export const summaryWritten = (goal: PeriodGoal | null): boolean => !!goal && goal.summary.trim().length > 0;

/**
 * За какой месяц пора писать итог — и пора ли вообще.
 *
 * Сначала прошлый: месяц, который кончился с целями и без итога, — это долг, и он важнее
 * текущего. Потом нынешний, но только под конец: просить итог десятого числа бессмысленно.
 *
 * Дальше чем на месяц назад не смотрит. Незакрытый июль в ноябре — уже не задача, а упрёк,
 * и строка, которую нельзя убрать иначе как задним числом что-то написать, быстро
 * перестаёт читаться вообще.
 */
export function summaryDue(goals: PeriodGoal[], today: string, leadDays = SUMMARY_LEAD_DAYS): string | null {
  const current = monthKey(today);
  const previous = prevMonth(current);
  const prevGoal = findGoal(goals, previous);
  if (hasContent(prevGoal) && !summaryWritten(prevGoal)) return previous;
  const currentGoal = findGoal(goals, current);
  if (daysLeftInMonth(today) <= leadDays && !summaryWritten(currentGoal)) return current;
  return null;
}

/**
 * Невыполненные пункты — с новыми id, чтобы старый месяц остался как есть.
 *
 * Перенос предлагается, а не делается сам: список, который дописывает себя каждое первое
 * число, за полгода превращается в свалку, из которой уже ничего не читают.
 */
export function carryItems(goal: PeriodGoal | null): GoalItem[] {
  if (!goal) return [];
  return goal.items.filter((i) => !i.done).map((i) => newItem(i.text));
}

/** Запись с изменённым пунктом. Всё остальное не трогается. */
export function toggleItem(goal: PeriodGoal, id: string): PeriodGoal {
  return { ...goal, items: goal.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) };
}
