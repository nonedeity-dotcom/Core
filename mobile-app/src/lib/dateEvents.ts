/**
 * Даты и события: дни рождения, встречи, всё, о чём нужно вспомнить.
 *
 * Весь файл — чистая логика без React и без expo: что за события, в какие дни они
 * выпадают, когда о них напоминать. Поэтому он проверяется обычным node, а экран и
 * планировщик уведомлений только пользуются им.
 *
 * Дни здесь — строки «ГГГГ-ММ-ДД» в местном времени, как и везде в приложении: их можно
 * сравнивать как строки, и они не едут от часового пояса.
 */

export type Repeat = "none" | "weekly" | "monthly" | "yearly";

/**
 * За сколько напоминать.
 *
 * `at` — в момент события, `hour`/`day`/`week` — за час, за день, за неделю до него.
 * Выбрать можно сколько угодно сразу: на день рождения часто нужны и «за неделю» (купить
 * подарок), и «за день», и «утром в тот день».
 */
export type Lead = "at" | "hour" | "day" | "week";

export interface DateEvent {
  id: string;
  title: string;
  /** Первый (или единственный) день события, «ГГГГ-ММ-ДД». Повторы считаются от него. */
  date: string;
  /** «ЧЧ:ММ» или null — событие на весь день. */
  time: string | null;
  repeat: Repeat;
  leads: Lead[];
}

/**
 * Во сколько напоминать про событие без времени.
 *
 * Событию «на весь день» не от чего отсчитывать «в момент» и «за день», поэтому у него
 * условное время — девять утра. Одна константа, а не настройка: день рождения в три часа
 * ночи никому не нужен, а девять подходит почти всем.
 */
export const ALL_DAY_HOUR = 9;

export const REPEATS: { id: Repeat; label: string }[] = [
  { id: "none", label: "Один раз" },
  { id: "weekly", label: "Каждую неделю" },
  { id: "monthly", label: "Каждый месяц" },
  { id: "yearly", label: "Каждый год" },
];

export const LEADS: { id: Lead; label: string }[] = [
  { id: "at", label: "В момент события" },
  { id: "hour", label: "За 1 час" },
  { id: "day", label: "За 1 день" },
  { id: "week", label: "За 1 неделю" },
];

const LEAD_IDS = LEADS.map((l) => l.id);
const REPEAT_IDS = REPEATS.map((r) => r.id);

/** «За час» имеет смысл только у события со временем: от девяти утра «час до» — это восемь. */
export function availableLeads(time: string | null): Lead[] {
  return time === null ? LEAD_IDS.filter((l) => l !== "hour") : [...LEAD_IDS];
}

export const MAX_TITLE = 80;

// ---------------------------------------------------------------------------
// Дни
// ---------------------------------------------------------------------------

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function daysInMonth(y: number, m: number): number {
  // m: 1–12. День 0 следующего месяца — последний день этого.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = KEY_RE.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidKey(key: unknown): key is string {
  return typeof key === "string" && parseKey(key) !== null;
}

export function keyOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Местный день в виде ключа. */
export function dateKey(date: Date): string {
  return keyOf(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function dayNumber(key: string): number {
  const p = parseKey(key)!;
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
}

export function addDays(key: string, n: number): string {
  const p = parseKey(key)!;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Сколько дней от `from` до `to`: завтра — 1, вчера — -1. */
export function dayDiff(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Месяц вперёд или назад; число подрезается, если в новом месяце его нет (31 января → 28 февраля). */
export function shiftMonth(key: string, n: number): string {
  const p = parseKey(key)!;
  const index = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return keyOf(y, m, Math.min(p.d, daysInMonth(y, m)));
}

export function shiftYear(key: string, n: number): string {
  return shiftMonth(key, n * 12);
}

/** Номер дня недели с понедельника: пн — 0, вс — 6. */
export function weekdayMon0(key: string): number {
  const p = parseKey(key)!;
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
}

// ---------------------------------------------------------------------------
// Когда событие выпадает
// ---------------------------------------------------------------------------

/**
 * Выпадает ли событие на этот день.
 *
 * До первого дня — никогда: день рождения, внесённый в ноябре, не «был» в прошлом марте.
 * Если нужного числа в месяце нет, событие переезжает на последний день: 31-е в апреле —
 * это 30 апреля, а 29 февраля в невисокосный год — 28-е. Иначе такое событие просто
 * молча пропускало бы месяцы и годы.
 */
export function occursOn(ev: DateEvent, key: string): boolean {
  const start = parseKey(ev.date);
  const at = parseKey(key);
  if (!start || !at || key < ev.date) return false;

  switch (ev.repeat) {
    case "none":
      return key === ev.date;
    case "weekly":
      return dayDiff(ev.date, key) % 7 === 0;
    case "monthly":
      return at.d === Math.min(start.d, daysInMonth(at.y, at.m));
    case "yearly":
      return at.m === start.m && at.d === Math.min(start.d, daysInMonth(at.y, at.m));
    default:
      return false;
  }
}

function byTimeThenTitle(a: DateEvent, b: DateEvent): number {
  // Без времени — сверху: это «весь день», оно было до всего остального.
  const ta = a.time ?? "";
  const tb = b.time ?? "";
  return ta === tb ? a.title.localeCompare(b.title) : ta < tb ? -1 : 1;
}

export function eventsOnDay(events: DateEvent[], key: string): DateEvent[] {
  return events.filter((e) => occursOn(e, key)).sort(byTimeThenTitle);
}

export interface Upcoming {
  event: DateEvent;
  /** День, на который выпало это повторение. */
  date: string;
}

/**
 * Ближайшие повторения, начиная с `fromKey` включительно.
 *
 * Окно в год с лишним: ежегодное событие должно найтись, даже если его день рождения был
 * вчера и следующий — через триста шестьдесят четыре дня.
 */
export function upcoming(events: DateEvent[], fromKey: string, limit: number, horizonDays = 366): Upcoming[] {
  const out: Upcoming[] = [];
  for (let i = 0; i <= horizonDays && out.length < limit; i++) {
    const key = addDays(fromKey, i);
    for (const event of eventsOnDay(events, key)) {
      out.push({ event, date: key });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export interface GridCell {
  key: string;
  day: number;
  inMonth: boolean;
}

/**
 * Сетка месяца: всегда шесть недель по семь дней, с понедельника.
 *
 * Шесть строк всегда, а не сколько нужно: иначе карточка на Главной подпрыгивает на
 * сорок пикселей при каждом перелистывании в месяц, где вместо пяти недель четыре.
 */
export function monthGrid(y: number, m: number): GridCell[] {
  const first = keyOf(y, m, 1);
  const start = addDays(first, -weekdayMon0(first));
  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const key = addDays(start, i);
    const p = parseKey(key)!;
    cells.push({ key, day: p.d, inMonth: p.y === y && p.m === m });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Напоминания
// ---------------------------------------------------------------------------

export interface Reminder {
  /** Стабильный id уведомления: по нему старое снимается и не дублируется новое. */
  key: string;
  eventId: string;
  /** День, про который напоминаем. */
  date: string;
  lead: Lead;
  at: Date;
}

/** Момент самого события: его время, а у события на весь день — девять утра. */
export function occurrenceMoment(ev: DateEvent, key: string): Date {
  const p = parseKey(key)!;
  const t = ev.time ? TIME_RE.exec(ev.time) : null;
  const hour = t ? Number(t[1]) : ALL_DAY_HOUR;
  const minute = t ? Number(t[2]) : 0;
  return new Date(p.y, p.m - 1, p.d, hour, minute, 0, 0);
}

/**
 * Момент напоминания.
 *
 * День и неделя отсчитываются по календарю, а не вычитанием 24 и 168 часов: в ночь
 * перевода часов эти числа не равны суткам, и «за день до 9:00» превратилось бы в 8:00
 * или 10:00.
 */
export function leadMoment(ev: DateEvent, key: string, lead: Lead): Date {
  const at = occurrenceMoment(ev, key);
  switch (lead) {
    case "hour":
      at.setHours(at.getHours() - 1);
      break;
    case "day":
      at.setDate(at.getDate() - 1);
      break;
    case "week":
      at.setDate(at.getDate() - 7);
      break;
    default:
      break;
  }
  return at;
}

/** Android не любит уведомления «на сейчас»: то, что вот-вот наступит, уже поздно планировать. */
const MIN_AHEAD_MS = 10_000;

/**
 * Что запланировать: ближайшие напоминания по всем событиям, не больше `cap`.
 *
 * Берутся именно ближайшие по времени, а не по первым событиям в списке. Дальние
 * допланируются при следующем открытии приложения: план каждый раз собирается заново от
 * «сейчас», поэтому раз в неделю повторяющееся событие не кончается, пока приложением
 * хоть иногда пользуются.
 */
export function planReminders(
  events: DateEvent[],
  now: Date,
  opts: { horizonDays?: number; cap?: number } = {},
): Reminder[] {
  const horizon = opts.horizonDays ?? 400;
  const cap = opts.cap ?? 60;
  const today = dateKey(now);
  const out: Reminder[] = [];

  for (const ev of events) {
    if (ev.leads.length === 0) continue;
    const leads = ev.leads.filter((l) => availableLeads(ev.time).includes(l));
    for (let i = 0; i <= horizon; i++) {
      const key = addDays(today, i);
      if (!occursOn(ev, key)) continue;
      for (const lead of leads) {
        const at = leadMoment(ev, key, lead);
        if (at.getTime() - now.getTime() < MIN_AHEAD_MS) continue;
        out.push({ key: `cal:${ev.id}:${key}:${lead}`, eventId: ev.id, date: key, lead, at });
      }
      // Одноразовое не ищем дальше первого совпадения.
      if (ev.repeat === "none") break;
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key)).slice(0, cap);
}

export function reminderText(ev: DateEvent, date: string, lead: Lead): { title: string; body: string } {
  const when = ev.time ? ` в ${ev.time}` : "";
  switch (lead) {
    case "hour":
      return { title: ev.title, body: `Через час${when}` };
    case "day":
      return { title: ev.title, body: `Завтра${when}` };
    case "week":
      return { title: ev.title, body: `Через неделю — ${formatDay(date, { weekday: true })}${when}` };
    default:
      return { title: ev.title, body: `Сегодня${when}` };
  }
}

// ---------------------------------------------------------------------------
// Подписи
// ---------------------------------------------------------------------------

const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_LONG = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

export function monthTitle(y: number, m: number): string {
  return `${MONTHS_NOM[m - 1]} ${y}`;
}

export function monthName(m: number): string {
  return MONTHS_GEN[m - 1];
}

/** «12 ноября», «12 ноября 2026», «четверг, 12 ноября». */
export function formatDay(key: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const p = parseKey(key);
  if (!p) return key;
  const base = `${p.d} ${MONTHS_GEN[p.m - 1]}${opts.year ? ` ${p.y}` : ""}`;
  return opts.weekday ? `${WEEKDAYS_LONG[weekdayMon0(key)]}, ${base}` : base;
}

function ruPlural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** «Сегодня», «Завтра», «Через 5 дней» — как далеко от сегодняшнего дня. */
export function relativeLabel(todayKey: string, key: string): string {
  const diff = dayDiff(todayKey, key);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  if (diff < 0) return formatDay(key);
  return `Через ${diff} ${ruPlural(diff, ["день", "дня", "дней"])}`;
}

export function repeatLabel(repeat: Repeat): string {
  switch (repeat) {
    case "weekly":
      return "каждую неделю";
    case "monthly":
      return "каждый месяц";
    case "yearly":
      return "каждый год";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Чтение из хранилища
// ---------------------------------------------------------------------------

/**
 * Достраивает событие из того, что лежит на диске или пришло из копии.
 *
 * Битая запись возвращает null и тихо выпадает из списка: одна испорченная строка не
 * должна ронять Главную, на которой этот календарь стоит.
 */
export function normalizeEvent(raw: unknown): DateEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  const title = typeof r.title === "string" ? r.title.trim().slice(0, MAX_TITLE) : "";
  if (title === "" || !isValidKey(r.date)) return null;

  const time = typeof r.time === "string" && TIME_RE.test(r.time) ? r.time : null;
  const repeat = REPEAT_IDS.includes(r.repeat as Repeat) ? (r.repeat as Repeat) : "none";
  const allowed = availableLeads(time);
  const leads = Array.isArray(r.leads)
    ? LEAD_IDS.filter((l) => (r.leads as unknown[]).includes(l) && allowed.includes(l))
    : [];

  return { id: r.id, title, date: r.date, time, repeat, leads };
}

export function normalizeEvents(raw: unknown): DateEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEvent).filter((e): e is DateEvent => e !== null);
}
