import { toDateKey } from "../date";

/**
 * Из потока системных событий — в интервалы и дневные итоги.
 *
 * Перенос `core/ForegroundSessionBuilder.kt` из creker. Перенесено на TypeScript, а не
 * оставлено в Kotlin, по одной причине: нативную часть нельзя выполнить нигде, кроме
 * телефона, а это самая тонкая арифметика во всём переезде. Здесь она покрыта тестами,
 * которые гоняются на месте, а Kotlin остаётся тонким слоем, который только отдаёт события.
 *
 * Система сообщает не длительности, а переходы: длительность сессии — это расстояние от
 * события, которое её открыло, до первого, которое её закрыло. Закрыть могут четверо:
 * другое приложение вышло на передний план, само приложение ушло в фон, погас экран, или
 * кончилось запрошенное окно.
 */

export type RawEventType =
  | "foreground"
  | "background"
  | "screenOn"
  | "screenOff"
  | "keyguardShown"
  | "keyguardHidden"
  | "shutdown";

export interface RawEvent {
  packageName: string;
  timestampMs: number;
  type: RawEventType;
}

export interface Interval {
  packageName: string;
  startMs: number;
  endMs: number;
}

export interface DailyUsage {
  date: string;
  packageName: string;
  usageMillis: number;
  launchCount: number;
}

function clipTo(interval: Interval, startMs: number, endMs: number): Interval | null {
  const start = Math.max(interval.startMs, startMs);
  const end = Math.min(interval.endMs, endMs);
  return end > start ? { ...interval, startMs: start, endMs: end } : null;
}

/**
 * Интервалы переднего плана.
 *
 * `events` должны покрывать окно с запасом назад: сессия, начавшаяся до его начала, иначе
 * потеряется целиком, а не обрежется.
 */
export function buildIntervals(
  events: RawEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number,
): Interval[] {
  const intervals: Interval[] = [];
  let openPackage: string | null = null;
  let openStartMs = 0;

  const close = (atMs: number) => {
    if (openPackage === null) return;
    if (atMs > openStartMs) intervals.push({ packageName: openPackage, startMs: openStartMs, endMs: atMs });
    openPackage = null;
  };

  for (const event of [...events].sort((a, b) => a.timestampMs - b.timestampMs)) {
    switch (event.type) {
      case "foreground":
        close(event.timestampMs);
        openPackage = event.packageName;
        openStartMs = event.timestampMs;
        break;
      case "background":
        if (openPackage === event.packageName) close(event.timestampMs);
        break;
      case "screenOff":
      case "keyguardShown":
      case "shutdown":
        close(event.timestampMs);
        break;
      default:
        break;
    }
  }
  // Открытая сессия не может тянуться дальше «сейчас»: будущего ещё не было.
  close(Math.min(rangeEndMs, nowMs));

  return intervals.map((i) => clipTo(i, rangeStartMs, rangeEndMs)).filter((i): i is Interval => i !== null);
}

const SINGLE_STREAM = "__device__";

/**
 * Один поток «открылось / закрылось» — в интервалы.
 *
 * В отличие от переднего плана, здесь нет ключа: одновременно открыт может быть только один,
 * и это верно и для включённого экрана, и для показанного замка.
 */
function buildSingleStream(
  events: RawEvent[],
  opensOn: RawEventType,
  closesOn: RawEventType,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number,
): Interval[] {
  const intervals: Interval[] = [];
  let openStartMs: number | null = null;
  for (const event of [...events].sort((a, b) => a.timestampMs - b.timestampMs)) {
    if (event.type === opensOn) {
      if (openStartMs === null) openStartMs = event.timestampMs;
    } else if (event.type === closesOn) {
      if (openStartMs === null) continue;
      if (event.timestampMs > openStartMs) {
        intervals.push({ packageName: SINGLE_STREAM, startMs: openStartMs, endMs: event.timestampMs });
      }
      openStartMs = null;
    }
  }
  if (openStartMs !== null) {
    const end = Math.min(rangeEndMs, nowMs);
    if (end > openStartMs) intervals.push({ packageName: SINGLE_STREAM, startMs: openStartMs, endMs: end });
  }
  return intervals.map((i) => clipTo(i, rangeStartMs, rangeEndMs)).filter((i): i is Interval => i !== null);
}

/** Вырезает из `base` всё, что попадает в `subtrahends`. */
function subtractIntervals(base: Interval[], subtrahends: Interval[]): Interval[] {
  if (subtrahends.length === 0) return base;
  const cuts = [...subtrahends].sort((a, b) => a.startMs - b.startMs);
  return base.flatMap((interval) => {
    let remaining: Interval[] = [interval];
    for (const cut of cuts) {
      remaining = remaining.flatMap((piece) => {
        const overlapStart = Math.max(piece.startMs, cut.startMs);
        const overlapEnd = Math.min(piece.endMs, cut.endMs);
        if (overlapStart >= overlapEnd) return [piece];
        const out: Interval[] = [];
        if (piece.startMs < overlapStart) out.push({ ...piece, endMs: overlapStart });
        if (piece.endMs > overlapEnd) out.push({ ...piece, startMs: overlapEnd });
        return out;
      });
    }
    return remaining;
  });
}

/**
 * Время включённого экрана, за вычетом того, что на нём показывался замок.
 *
 * Строится из двух независимых пар событий, а не из одной: экран может включиться, ни разу
 * не показав замка (способ блокировки не задан), и тогда вычитать нечего.
 */
export function buildScreenOnIntervals(
  events: RawEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs: number,
): Interval[] {
  const screenOn = buildSingleStream(events, "screenOn", "screenOff", rangeStartMs, rangeEndMs, nowMs);
  const keyguard = buildSingleStream(events, "keyguardShown", "keyguardHidden", rangeStartMs, rangeEndMs, nowMs);
  return subtractIntervals(screenOn, keyguard);
}

/** Полночь следующего дня после `ms`, по местному времени. */
function nextLocalMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * Режет интервалы по местной полуночи и складывает по дню и пакету.
 *
 * Сессия через полночь достаётся обоим дням — своей частью каждому. Иначе ночь целиком
 * записывалась бы в тот день, в котором началась, и «во вторник шесть часов» означало бы
 * «во вторник вечером и в среду до двух ночи».
 */
export function toDailyUsage(
  intervals: Interval[],
  launches: Map<string, number> = new Map(),
): DailyUsage[] {
  const totals = new Map<string, number>();
  const key = (date: string, pkg: string) => `${date}|${pkg}`;

  for (const interval of intervals) {
    let cursor = interval.startMs;
    while (cursor < interval.endMs) {
      const date = toDateKey(new Date(cursor));
      // Защита от часового пояса, в котором полночь не сдвинулась вперёд.
      const chunkEnd = Math.min(Math.max(nextLocalMidnight(cursor), cursor + 1), interval.endMs);
      const k = key(date, interval.packageName);
      totals.set(k, (totals.get(k) ?? 0) + (chunkEnd - cursor));
      cursor = chunkEnd;
    }
  }

  const keys = new Set([...totals.keys(), ...launches.keys()]);
  return [...keys]
    .map((k) => {
      const [date, packageName] = k.split("|");
      return {
        date,
        packageName,
        usageMillis: totals.get(k) ?? 0,
        launchCount: launches.get(k) ?? 0,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.packageName.localeCompare(b.packageName));
}

/** Сколько раз каждое приложение выходило на передний план, по дням. */
export function countLaunches(events: RawEvent[], rangeStartMs: number, rangeEndMs: number): Map<string, number> {
  const launches = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "foreground") continue;
    if (event.timestampMs < rangeStartMs || event.timestampMs >= rangeEndMs) continue;
    const k = `${toDateKey(new Date(event.timestampMs))}|${event.packageName}`;
    launches.set(k, (launches.get(k) ?? 0) + 1);
  }
  return launches;
}

/**
 * До какого момента день досчитан.
 *
 * Для прошедшего дня это его полночь: он весь учтён. Для сегодняшнего — «сейчас»: по этому
 * числу читающая сторона понимает, насколько бегущий итог отстал. Перенесено из creker
 * (`core/DayCompleteness.kt`) вместе со смыслом: без него «экран был выключен всё утро» и
 * «утро никто не мерил» выглядят одинаково низким числом.
 */
export function measuredThroughMs(date: string, nowMs: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const endOfDay = new Date(y, m - 1, d + 1).getTime();
  return Math.min(endOfDay, nowMs);
}

/** Одно значение на час суток. */
export interface HourlyValue {
  hour: number;
  value: number;
}

/**
 * Интервалы, разложенные по 24 часам суток, — для графика одного дня.
 *
 * Считается на лету из системных событий, а не хранится: система держит подробные события
 * считанные дни, и почасовая разбивка существует ровно для них. Хранить её за всю историю
 * значило бы хранить в двадцать четыре раза больше ради экрана, который открывают на
 * сегодняшнем дне.
 */
export function toHourlyUsage(intervals: Interval[]): HourlyValue[] {
  const totals = new Array<number>(24).fill(0);
  for (const interval of intervals) {
    let cursor = interval.startMs;
    while (cursor < interval.endMs) {
      const d = new Date(cursor);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const chunkEnd = Math.min(Math.max(nextHour, cursor + 1), interval.endMs);
      totals[d.getHours()] += chunkEnd - cursor;
      cursor = chunkEnd;
    }
  }
  return totals.map((value, hour) => ({ hour, value }));
}

/** Запуски по часам суток — то же для метрики «сколько раз открывал». */
export function toHourlyLaunches(events: RawEvent[], rangeStartMs: number, rangeEndMs: number): HourlyValue[] {
  const counts = new Array<number>(24).fill(0);
  for (const event of events) {
    if (event.type !== "foreground") continue;
    if (event.timestampMs < rangeStartMs || event.timestampMs >= rangeEndMs) continue;
    counts[new Date(event.timestampMs).getHours()] += 1;
  }
  return counts.map((value, hour) => ({ hour, value }));
}

/** Только интервалы одного пакета — для почасового графика отдельного приложения. */
export function onlyPackage(intervals: Interval[], packageName: string): Interval[] {
  return intervals.filter((i) => i.packageName === packageName);
}
