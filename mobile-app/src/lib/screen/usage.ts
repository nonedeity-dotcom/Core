/**
 * Экранное время: что приложение хранит у себя и что из этого считается.
 *
 * Данные приходят от creker и переписываются сюда. Своя копия нужна не для скорости: creker
 * будет удалён, и всё, что останется только у него, исчезнет вместе с ним. Поэтому история
 * переезжает целиком и живёт здесь, а creker — временный источник, а не хранилище.
 */

/** Общее время экрана за один день. */
export interface ScreenDay {
  date: string;
  screenMillis: number;
  /**
   * До какого момента `screenMillis` за этот день досчитан — не когда запись сделана.
   * Ноль значит «неизвестно»: строка от сборки creker старше этой колонки.
   */
  updatedAt: number;
  /**
   * Сколько раз в этот день телефон разблокировали.
   *
   * Отсутствует у дней, записанных до появления этого числа, и у всего, что пришло из
   * creker: он такого не считал. Пересчитать задним числом нечем — подробные события
   * система хранит несколько суток.
   */
  unlocks?: number;
}

/** Время одного приложения за один день. */
export interface AppDay {
  date: string;
  packageName: string;
  /** Читаемое имя на момент переноса. Пакет мог быть удалён — тогда здесь сам пакет. */
  label: string;
  usageMillis: number;
  launchCount: number;
}

/** Итог одного приложения за период. */
export interface AppTotal {
  packageName: string;
  label: string;
  usageMillis: number;
  launchCount: number;
  /** Сколько дней из периода приложение вообще открывали. */
  daysUsed: number;
  /** Доля от самого большого приложения — ширина полоски за строкой. */
  shareOfTop: number;
  /** Доля от всего времени за период — процент рядом со строкой. */
  shareOfTotal: number;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeScreenDay(value: unknown): ScreenDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isStr(v.date) || !DATE_RE.test(v.date)) return null;
  return {
    date: v.date,
    screenMillis: Math.round(num(v.screenMillis)),
    updatedAt: Math.round(num(v.updatedAt)),
    ...(typeof v.unlocks === "number" && Number.isFinite(v.unlocks) ? { unlocks: Math.round(num(v.unlocks)) } : {}),
  };
}

export function normalizeAppDay(value: unknown): AppDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isStr(v.date) || !DATE_RE.test(v.date)) return null;
  if (!isStr(v.packageName) || v.packageName === "") return null;
  return {
    date: v.date,
    packageName: v.packageName,
    label: isStr(v.label) && v.label !== "" ? v.label : v.packageName,
    usageMillis: Math.round(num(v.usageMillis)),
    launchCount: Math.round(num(v.launchCount)),
  };
}

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;

export function daysInRange(days: ScreenDay[], from: string, to: string): ScreenDay[] {
  return days.filter((d) => inRange(d.date, from, to)).sort((a, b) => a.date.localeCompare(b.date));
}

export function appsInRange(rows: AppDay[], from: string, to: string): AppDay[] {
  return rows.filter((r) => inRange(r.date, from, to));
}

/** Сколько раз телефон разблокировали за период. */
export function totalUnlocks(days: ScreenDay[]): number {
  return days.reduce((sum, d) => sum + (d.unlocks ?? 0), 0);
}

/** Сумма экранного времени за период. */
export function totalScreenMillis(days: ScreenDay[]): number {
  return days.reduce((sum, d) => sum + d.screenMillis, 0);
}

/**
 * Приложения за период, сложенные по пакету и отсортированные по времени.
 *
 * Имя берётся из самой свежей строки: приложение могли переименовать или удалить, и более
 * позднее название ближе к тому, что человек увидит у себя на телефоне сейчас.
 */
export function totalsByApp(rows: AppDay[]): AppTotal[] {
  type Acc = Omit<AppTotal, "shareOfTop" | "shareOfTotal"> & { lastDate: string };
  const acc = new Map<string, Acc>();
  for (const row of rows) {
    if (row.usageMillis <= 0) continue;
    const current = acc.get(row.packageName);
    if (!current) {
      acc.set(row.packageName, {
        packageName: row.packageName,
        label: row.label,
        usageMillis: row.usageMillis,
        launchCount: row.launchCount,
        daysUsed: 1,
        lastDate: row.date,
      });
      continue;
    }
    current.usageMillis += row.usageMillis;
    current.launchCount += row.launchCount;
    current.daysUsed += 1;
    if (row.date >= current.lastDate) {
      current.label = row.label;
      current.lastDate = row.date;
    }
  }
  const list = [...acc.values()]
    .map(({ lastDate: _lastDate, ...rest }) => rest)
    .sort((a, b) => b.usageMillis - a.usageMillis || a.label.localeCompare(b.label, "ru"));

  // Доли считаются от суммы именно приложений, а не от экранного времени: экран бывает
  // включён и без единого приложения на переднем плане, и тогда проценты не сошлись бы в сто.
  const sum = list.reduce((s, a) => s + a.usageMillis, 0);
  const top = list[0]?.usageMillis ?? 0;
  return list.map((app) => ({
    ...app,
    shareOfTop: top > 0 ? app.usageMillis / top : 0,
    shareOfTotal: sum > 0 ? app.usageMillis / sum : 0,
  }));
}

/**
 * Первый день, о котором вообще что-то сохранено.
 *
 * Нужен, чтобы отличить «в этот период ничего не было» от «этот период глубже, чем мы
 * помним». Второе — не ноль, а незнание, и показывать его нулём значит соврать.
 */
export function earliestStoredDay(days: ScreenDay[], apps: AppDay[]): string | null {
  let earliest: string | null = null;
  for (const d of days) if (!earliest || d.date < earliest) earliest = d.date;
  for (const a of apps) if (!earliest || a.date < earliest) earliest = a.date;
  return earliest;
}

/** История одного приложения по дням, в порядке дат. */
export function historyFor(rows: AppDay[], packageName: string): AppDay[] {
  return rows.filter((r) => r.packageName === packageName).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Серия дней подряд, в которые приложением пользовались, считая назад от `today`.
 *
 * Перенесено из creker (`core/UsageStreaks.kt`) вместе с его правилом: «пользовались» —
 * это любое ненулевое время, без порога. Ноль, если сегодня им ещё не пользовались.
 */
export function currentStreak(history: AppDay[], today: string): number {
  const used = new Set(history.filter((h) => h.usageMillis > 0).map((h) => h.date));
  let streak = 0;
  let day = today;
  while (used.has(day)) {
    streak++;
    day = shiftBack(day);
  }
  return streak;
}

/** Самая длинная череда дней подряд за всю историю. */
export function longestStreak(history: AppDay[]): number {
  const used = [...new Set(history.filter((h) => h.usageMillis > 0).map((h) => h.date))].sort();
  if (used.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < used.length; i++) {
    current = shiftBack(used[i]) === used[i - 1] ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Самое большое время за один день. */
export function maxDayUsage(history: AppDay[]): number {
  return history.reduce((max, h) => Math.max(max, h.usageMillis), 0);
}

/** Предыдущий день. Локальный полдень, чтобы перевод часов не сдвинул дату на сутки. */
function shiftBack(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const cursor = new Date(y, m - 1, d, 12);
  cursor.setDate(cursor.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${cursor.getFullYear()}-${p(cursor.getMonth() + 1)}-${p(cursor.getDate())}`;
}
