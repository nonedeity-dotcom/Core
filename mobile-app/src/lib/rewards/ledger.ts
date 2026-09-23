import { shiftDate } from "../date";
import { isDayOff, type DayOffRule } from "../dayOff";
import type { Habit, HabitLog } from "../../types";

/**
 * Журнал рассчитанных дней: что про каждый прошедший день решено, и решено навсегда.
 *
 * Зачем он. Награды раньше выводились из состояния целиком, при каждом открытии, по
 * нынешним правилам. Защита «одно событие — одна оплата» держалась, а обещание «сменишь
 * правило — задним числом ничего не доплатится» — нет: понизил планку дня, старые дни
 * пересчитались закрытыми, их ключей в оплаченном не было, и они оплачивались. Проверка
 * это показала: тридцать искр и ядро за веху из ничего. С лимитом экрана то же самое.
 *
 * Теперь день рассчитывается один раз — когда он окончательно закончился — и итог
 * записывается сюда. Дальше правила его не трогают: вехи, титулы и оплата смотрят на
 * записанное, а нынешние правила решают только про дни, которые ещё открыты.
 *
 * Заодно это чинит второе: титулы больше не зависят от окна, в которое заглядывает
 * начисление. Серия в шестьдесят шесть дней, случившаяся два года назад, лежит здесь, и
 * «Автопилот» не пропадёт оттого, что она выпала из последних четырёхсот дней.
 *
 * Модуль чистый: на входе журнал и нынешние вердикты, на выходе новый журнал.
 */

export interface Ledger {
  /** Всё до этой даты включительно рассчитано и больше не пересматривается. "" — ни разу. */
  through: string;
  /** Рассчитанные закрытые дни. */
  closed: string[];
  /** Рассчитанные дни, которые серию не рвут, хоть и не закрыты: выходной или заморозка. */
  rest: string[];
  /** Рассчитанные дни, в которые все экранные привычки удержались. */
  screen: string[];
}

export const EMPTY_LEDGER: Ledger = { through: "", closed: [], rest: [], screen: [] };

/**
 * Через сколько дней день считается окончательным.
 *
 * Два, а не один: вчерашнюю привычку можно отметить сегодня, а экранное время за вчера
 * досчитывается утром. Позавчерашний день уже никто честно не поменяет — кроме смены
 * правил, от которой журнал и защищает.
 */
export const SETTLE_LAG_DAYS = 2;

/** Что нынешние правила говорят про дни в окне, которое удалось прочитать. */
export interface Verdicts {
  /** Начало окна: раньше этой даты данных нет, и про те дни вердикта тоже нет. */
  from: string;
  closed: Set<string>;
  rest: Set<string>;
  screen: Set<string>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dates = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && DATE_RE.test(x)))].sort() : [];

export function normalizeLedger(raw: unknown): Ledger {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_LEDGER };
  const o = raw as Record<string, unknown>;
  return {
    through: typeof o.through === "string" && DATE_RE.test(o.through) ? o.through : "",
    closed: dates(o.closed),
    rest: dates(o.rest),
    screen: dates(o.screen),
  };
}

const merged = (a: string[], b: Iterable<string>): string[] => [...new Set([...a, ...b])].sort();

/**
 * Дописать в журнал дни, которые успели закончиться.
 *
 * Первый расчёт берёт всё окно — так начисление за прошлое, обещанное с самого начала,
 * остаётся в силе. И к нему добавляется то, что уже было оплачено раньше (`seed`): эти дни
 * когда-то посчитаны закрытыми и оплачены, и выкинуть их из журнала значило бы задним
 * числом отменить уже вынесенный вердикт — ровно то, от чего журнал и защищает.
 */
export function settle(
  ledger: Ledger,
  verdicts: Verdicts,
  today: string,
  seed: { closed: string[]; screen: string[] } = { closed: [], screen: [] },
): Ledger {
  const until = shiftDate(today, -SETTLE_LAG_DAYS);
  if (ledger.through !== "" && ledger.through >= until) return ledger;

  const first = ledger.through === "";
  const start = first ? verdicts.from : shiftDate(ledger.through, 1);
  const inRange = (d: string) => d >= start && d <= until;
  const pick = (set: Set<string>) => [...set].filter(inRange);

  return {
    through: until,
    closed: merged(ledger.closed, [...pick(verdicts.closed), ...(first ? seed.closed.filter((d) => d <= until) : [])]),
    rest: merged(ledger.rest, pick(verdicts.rest)),
    screen: merged(ledger.screen, [...pick(verdicts.screen), ...(first ? seed.screen.filter((d) => d <= until) : [])]),
  };
}

/**
 * Итог по всем дням: записанное — из журнала, ещё открытое — по нынешним правилам.
 */
export function effective(ledger: Ledger, verdicts: Verdicts): { closed: Set<string>; rest: Set<string>; screen: Set<string> } {
  const open = (d: string) => ledger.through === "" || d > ledger.through;
  const join = (settled: string[], current: Set<string>) => new Set([...settled, ...[...current].filter(open)]);
  return {
    closed: join(ledger.closed, verdicts.closed),
    rest: join(ledger.rest, verdicts.rest),
    screen: join(ledger.screen, verdicts.screen),
  };
}

/** Самая ранняя дата, про которую что-то известно, — с неё считается серия за всё время. */
export function earliest(ledger: Ledger, verdicts: Verdicts): string {
  const firsts = [ledger.closed[0], ledger.rest[0], ledger.screen[0], verdicts.from].filter(
    (d): d is string => typeof d === "string",
  );
  return firsts.reduce((min, d) => (d < min ? d : min));
}

/**
 * Дни, которые серию не рвут: заморозки и выходные, если день не закрыт.
 *
 * Выходной здесь — по нынешнему правилу, но это касается только открытых дней: закрытые
 * уже в журнале, и объявить все воскресенья выходными задним числом больше ничего не даёт.
 */
export function restDays(
  closed: Set<string>,
  freezes: string[],
  daysOff: DayOffRule,
  from: string,
  today: string,
): Set<string> {
  const out = new Set<string>();
  for (const d of freezes) if (d >= from && d <= today && !closed.has(d)) out.add(d);
  for (let d = from; d <= today; d = shiftDate(d, 1)) {
    if (!closed.has(d) && isDayOff(d, daysOff)) out.add(d);
  }
  return out;
}

/**
 * Дни, в которые все экранные привычки удержались.
 *
 * Раньше награда за экран мерилась общим лимитом из настроек Creker, а сами привычки —
 * своими, и в один можно было уложиться, а в другой нет. Теперь мера одна — привычки:
 * день засчитан, когда каждая экранная привычка, которая в тот день уже существовала,
 * отмечена сделанной. Нет экранных привычек — нет и такой награды: мерить нечем.
 */
export function screenHabitDates(habits: Habit[], logs: HabitLog[]): Set<string> {
  // Только «не больше»: награда и титул «Отключённый» — про то, что удержался от экрана.
  // «Читалка не меньше двадцати минут» — это привычка к чему-то, а не отказ от телефона, и
  // закрывает день она наравне со всеми остальными.
  const watchers = habits.filter(
    (h) => h.auto === "screentime" && h.screen && (h.screen.direction ?? "atMost") === "atMost",
  );
  const out = new Set<string>();
  if (watchers.length === 0) return out;

  const done = new Map<string, Set<string>>();
  for (const l of logs) {
    if (!l.done) continue;
    const day = done.get(l.date) ?? new Set<string>();
    day.add(l.habitId);
    done.set(l.date, day);
  }

  for (const [date, ids] of done) {
    const owed = watchers.filter((h) => !h.createdAt || h.createdAt <= date);
    if (owed.length > 0 && owed.every((h) => ids.has(h.id))) out.add(date);
  }
  return out;
}

/** Даты из ключей оплаченного: `day:2026-09-14` → `2026-09-14`. */
export const paidDates = (paid: string[], prefix: "day" | "screen"): string[] =>
  paid.filter((k) => k.startsWith(`${prefix}:`)).map((k) => k.slice(prefix.length + 1));
