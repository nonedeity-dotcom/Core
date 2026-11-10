/**
 * Итоги дня — короткая запись о том, как прошёл день.
 *
 * Один итог на дату: его можно писать в тот же день и задним числом, перечитывать и
 * переписывать. Здесь только то, что не зависит от экрана и хранилища, — вид записи, её
 * проверка, слияние двух копий и сетка месяца для календаря, — чтобы проверять это без
 * телефона.
 */

export interface DayNote {
  /** День, о котором итог, «yyyy-MM-dd». Он же — ключ: на дату один итог. */
  date: string;
  text: string;
  /** Когда итог последний раз правили (ISO). По нему при слиянии берётся более новый. */
  updatedAt: string;
}

/** Потолок длины: итог дня — запись, а не роман, и всё хранилище лежит в одной базе. */
export const DAY_NOTE_MAX = 5000;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Настоящая ли это дата: «2026-02-31» по форме подходит, а такого дня нет. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

/**
 * Запись из хранилища или из чужой копии — или null, если она негодная.
 *
 * Негодная запись тихо выпадает, а не роняет экран: так же читаются и события на Главной.
 * Пустой итог тоже не запись — он значит «итога нет».
 */
export function normalizeNote(raw: unknown): DayNote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isDateKey(r.date) || typeof r.text !== "string") return null;
  const text = r.text.trim().slice(0, DAY_NOTE_MAX).trim();
  if (text === "") return null;
  const updatedAt =
    typeof r.updatedAt === "string" && !Number.isNaN(Date.parse(r.updatedAt))
      ? r.updatedAt
      : new Date(0).toISOString();
  return { date: r.date, text, updatedAt };
}

/** Список итогов: негодные выпадают, на дату остаётся один (более новый), свежие дни сверху. */
export function normalizeNotes(raw: unknown): DayNote[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, DayNote>();
  for (const item of raw) {
    const note = normalizeNote(item);
    if (!note) continue;
    const have = byDate.get(note.date);
    // При равных часах побеждает та, что позже в списке: её дописали после.
    if (!have || Date.parse(note.updatedAt) >= Date.parse(have.updatedAt)) byDate.set(note.date, note);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Два списка в один при восстановлении из копии: по каждой дате берётся более свежая правка.
 * Итоги из копии, которых здесь нет, добавляются; здешние, которых нет в копии, остаются.
 */
export function mergeNotes(local: DayNote[], incoming: unknown): DayNote[] {
  return normalizeNotes([...normalizeNotes(incoming), ...local].sort(byUpdatedAt));
}

const byUpdatedAt = (a: unknown, b: unknown): number =>
  Date.parse((a as DayNote).updatedAt) - Date.parse((b as DayNote).updatedAt);

/** Первые слова итога одной строкой — для списка и для карточки на Отчёте. */
export function previewOf(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export interface MonthRef {
  year: number;
  /** 0–11, как у Date. */
  month: number;
}

export function monthTitle({ year, month }: MonthRef): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function shiftMonth({ year, month }: MonthRef, delta: number): MonthRef {
  const index = year * 12 + month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export function monthOf(dateKey: string): MonthRef {
  const [y, m] = dateKey.split("-").map(Number);
  return { year: y, month: m - 1 };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Месяц неделями, с понедельника: в каждой неделе семь мест, пустые — null.
 *
 * Ключи собираются руками, а не через Date → ISO-строку: та переводит в UTC, и к востоку от
 * Гринвича полночь первого числа превращалась бы в последнее число прошлого месяца.
 */
export function monthWeeks({ year, month }: MonthRef): (string | null)[][] {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
