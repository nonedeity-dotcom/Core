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
  /**
   * Сколько раз это надо сделать за период. Нет — значит шаг обычный, на одну галочку.
   *
   * «Сходить в зал 12 раз» галочкой не меряется: весь месяц он выглядит невыполненным, а
   * тридцатого разом закрывается. С числом видно 7 из 12 — то есть видно, что шаг идёт.
   */
  target?: number;
  /** Сколько уже сделано. Осмысленно только вместе с target. */
  count?: number;
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

export function newItem(text: string, target?: number): GoalItem {
  const item: GoalItem = { id: uid(), text: text.trim(), done: false };
  return target !== undefined && target > 1 ? { ...item, target: Math.round(target), count: 0 } : item;
}

/** Сколько раз шаг просят сделать. Обычный шаг — один. */
export const itemTarget = (item: GoalItem): number =>
  item.target !== undefined && item.target > 1 ? item.target : 1;

/** Сколько сделано. У обычного шага это его галочка. */
export const itemCount = (item: GoalItem): number =>
  item.target !== undefined && item.target > 1 ? Math.max(0, item.count ?? 0) : item.done ? 1 : 0;

/**
 * Закрыт ли шаг.
 *
 * Одна проверка на оба вида, потому что «сколько закрыто» спрашивают в пяти местах, и пять
 * раз написать `done || count >= target` — это пять мест, где однажды напишут по-разному.
 */
export const itemDone = (item: GoalItem): boolean => itemCount(item) >= itemTarget(item);

/** Больше сотни раз за месяц — это уже не шаг, а привычка, и ей есть отдельный раздел. */
export const MAX_ITEM_TARGET = 99;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const posInt = (v: unknown, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(0, Math.round(v))) : null;

function normalizeItem(raw: unknown): GoalItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const text = str(o.text).trim();
  if (!text) return null;
  const item: GoalItem = { id: str(o.id) || uid(), text, done: o.done === true };
  const target = posInt(o.target, MAX_ITEM_TARGET);
  // Единица и ноль — это обычный шаг: хранить у него счётчик значит завести второй способ
  // сказать то же самое, и однажды они разойдутся.
  if (target === null || target <= 1) return item;
  return { ...item, target, count: Math.min(target, posInt(o.count, MAX_ITEM_TARGET) ?? 0) };
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
  return { done: goal.items.filter(itemDone).length, total: goal.items.length };
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
  return goal.items.filter((i) => !itemDone(i)).map((i) => newItem(i.text, i.target));
}

/**
 * Весь прошлый месяц заново — и выполненное тоже.
 *
 * Не то же самое, что перенос хвостов. «Двенадцать тренировок» повторяются каждый месяц
 * именно потому, что в прошлом их закрыли; переносить только провалы значило бы каждый раз
 * заводить удавшееся руками.
 */
export function repeatItems(goal: PeriodGoal | null): GoalItem[] {
  if (!goal) return [];
  return goal.items.map((i) => newItem(i.text, i.target));
}

/** Запись с изменённым пунктом. Всё остальное не трогается. */
export function toggleItem(goal: PeriodGoal, id: string): PeriodGoal {
  return {
    ...goal,
    items: goal.items.map((i) => {
      if (i.id !== id) return i;
      // У шага со счётчиком нажатие только добавляет и упирается в цель. Обнулять его
      // нажатием нельзя: один промах пальцем стёр бы двенадцать походов в зал. Убавляется
      // он отдельной кнопкой — см. stepItem.
      if (i.target !== undefined && i.target > 1) {
        return { ...i, count: Math.min(i.target, itemCount(i) + 1) };
      }
      return { ...i, done: !i.done };
    }),
  };
}

/**
 * Счётчик шага на единицу вверх или вниз.
 *
 * Отдельно от нажатия по строке, потому что убавление должно быть намеренным: «12 из 12»,
 * стёртые случайным касанием, — это месяц работы, который нечем восстановить.
 */
export function stepItem(goal: PeriodGoal, id: string, delta: number): PeriodGoal {
  return {
    ...goal,
    items: goal.items.map((i) =>
      i.id === id && i.target !== undefined && i.target > 1
        ? { ...i, count: Math.min(i.target, Math.max(0, itemCount(i) + delta)) }
        : i,
    ),
  };
}

/** Новое имя шага. Пустое имя не сохраняется: шаг без текста — это удалённый шаг. */
export function renameItem(goal: PeriodGoal, id: string, text: string): PeriodGoal {
  const clean = text.trim();
  if (!clean) return goal;
  return { ...goal, items: goal.items.map((i) => (i.id === id ? { ...i, text: clean } : i)) };
}

/**
 * Состояние месяца в полоске года.
 *
 * Четыре, и различать их важнее, чем кажется. «Пусто» — цели не ставили, и упрекать не за
 * что. «Идёт» — цель есть, месяц не кончился. «Закрыт» — итог написан. «Долг» — месяц
 * кончился с целями и без итога, и это единственное состояние, которое чего-то просит.
 */
export type MonthState = "empty" | "planned" | "closed" | "due";

export interface MonthCell {
  period: string;
  /** 1…12 — для подписи. */
  month: number;
  state: MonthState;
  /** Тот месяц, который идёт сейчас. */
  current: boolean;
  /** Отмечено шагов и всего — для подписи под клеткой. */
  done: number;
  total: number;
}

/** Двенадцать ключей месяцев года: «2026» → «2026-01» … «2026-12». */
export function yearMonths(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** Год целиком — то, из чего рисуется полоска из двенадцати клеток. */
export function yearCells(goals: PeriodGoal[], year: string, today: string): MonthCell[] {
  const now = monthKey(today);
  return yearMonths(year).map((period, i) => {
    const goal = findGoal(goals, period);
    const p = goalProgress(goal);
    const over = period < now;
    const state: MonthState = summaryWritten(goal)
      ? "closed"
      : !hasContent(goal)
        ? "empty"
        : over
          ? "due"
          : "planned";
    return { period, month: i + 1, state, current: period === now, done: p.done, total: p.total };
  });
}

/**
 * Подпись под одной кнопкой «Цель» на «Отчёте».
 *
 * Кнопка одна, а сказать ей надо разное: обычно — как идёт этот месяц, под конец — что итог
 * ещё не написан, а если цели нет вовсе — позвать её поставить. Строка одна и та же, и
 * именно поэтому она должна меняться: второй строки, чтобы досказать, здесь нет.
 */
export function goalSubtitle(goals: PeriodGoal[], today: string): string {
  const current = monthKey(today);
  const due = summaryDue(goals, today);
  if (due !== null && due !== current) return `${periodTitle(due)} кончился, а итога нет`;
  const goal = findGoal(goals, current);
  if (!hasContent(goal)) return `Поставить цель на ${periodAccusative(current)}`;
  if (due === current) return `${periodAccusative(current)} кончается — итога нет`;
  const p = goalProgress(goal);
  const left = daysLeftInMonth(today);
  const tail = left === 0 ? "последний день" : `осталось ${left} дн.`;
  return p.total > 0
    ? `${periodAccusative(current)} · отмечено ${p.done} из ${p.total} · ${tail}`
    : `${periodAccusative(current)} · ${tail}`;
}
