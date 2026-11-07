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
 *
 * Разбивка по приложениям для окна часа лежит отдельно (`HourAppsDay` ниже) и хранится
 * только за последние месяцы: на длинной истории она и была бы той самой тяжёлой частью.
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

/**
 * Разбивка часов одного дня по приложениям.
 *
 * Хранится отдельно от `HourlyDay`, под своим ключом: общие ряды читаются на каждый показ
 * графика, а эта таблица нужна только тому, кто нажал на час. Сорок приложений на двадцать
 * четыре часа — сотни чисел на день, и тащить их вместе с общей картиной ради каждого
 * открытия экрана незачем.
 *
 * Хранится только ненулевое и разреженно: пакет → пары «час, миллисекунды». Приложение за
 * день сидит в нескольких часах, а не во всех двадцати четырёх, и ряд из двадцати четырёх
 * чисел на каждое было бы в основном нулями.
 */
export interface HourAppsDay {
  date: string;
  byApp: Record<string, Array<[hour: number, millis: number]>>;
}

/** Одно приложение в одном часу. */
export interface HourApp {
  packageName: string;
  millis: number;
}

/**
 * Меньше этого приложение в часе не записывается.
 *
 * Секунда на переднем плане — это мелькнувшее уведомление или переключение между окнами, а
 * не то, чем человек пользовался; а строк такие обрывки дали бы больше всех настоящих.
 */
export const HOUR_APP_MIN_MS = 1000;

/** Объект без прототипа: имя пакета — чужая строка, и `__proto__` среди них быть не должно. */
const emptyByApp = (): HourAppsDay["byApp"] => Object.create(null) as HourAppsDay["byApp"];

/**
 * Из рядов «пакет → 24 числа», посчитанных по событиям, — в то, что хранится.
 * `null` — за день не набралось ни одного приложения: такой день хранить незачем.
 */
export function packHourApps(date: string, byPackage: Map<string, number[]>): HourAppsDay | null {
  const byApp = emptyByApp();
  let any = false;
  for (const [packageName, row] of byPackage) {
    const cells: Array<[number, number]> = [];
    for (let hour = 0; hour < HOURS; hour++) {
      const millis = Math.round(row[hour] ?? 0);
      if (millis >= HOUR_APP_MIN_MS) cells.push([hour, millis]);
    }
    if (cells.length === 0) continue;
    byApp[packageName] = cells;
    any = true;
  }
  return any ? { date, byApp } : null;
}

/** День из хранилища: чужих часов, дробей и мусора внутри быть не должно. */
export function normalizeHourAppsDay(value: unknown): HourAppsDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string" || !DATE_RE.test(v.date)) return null;
  if (typeof v.byApp !== "object" || v.byApp === null || Array.isArray(v.byApp)) return null;

  const byApp = emptyByApp();
  for (const [packageName, cells] of Object.entries(v.byApp as Record<string, unknown>)) {
    if (packageName === "" || !Array.isArray(cells)) continue;
    const row = new Array<number>(HOURS).fill(0);
    for (const cell of cells) {
      if (!Array.isArray(cell)) continue;
      const [hour, millis] = cell as unknown[];
      if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour >= HOURS) continue;
      if (typeof millis !== "number" || !Number.isFinite(millis) || millis <= 0) continue;
      row[hour] += Math.round(millis);
    }
    const clean: Array<[number, number]> = [];
    row.forEach((ms, hour) => {
      if (ms > 0) clean.push([hour, ms]);
    });
    if (clean.length > 0) byApp[packageName] = clean;
  }
  return { date: v.date, byApp };
}

export function isEmptyHourAppsDay(day: HourAppsDay): boolean {
  return Object.keys(day.byApp).length === 0;
}

/** Приложения одного часа, от самого долгого к самому короткому. */
export function appsInHour(day: HourAppsDay, hour: number): HourApp[] {
  const out: HourApp[] = [];
  for (const [packageName, cells] of Object.entries(day.byApp)) {
    for (const [h, millis] of cells) {
      if (h === hour) out.push({ packageName, millis });
    }
  }
  return out.sort((a, b) => b.millis - a.millis || a.packageName.localeCompare(b.packageName));
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
