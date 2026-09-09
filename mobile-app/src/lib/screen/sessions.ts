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

/**
 * Настоящие открытия приложений из потока событий.
 *
 * Система шлёт «вышел на передний план» и при переходе между экранами внутри самого
 * приложения: открыл переписку, вернулся в список — два события, одно приложение, ноль
 * новых открытий. Поэтому считается смена приложения, а не каждое событие.
 *
 * Погасший экран и замок сбрасывают текущее: вернуться в то же приложение после блокировки
 * — это открыть его снова, а не продолжить, и человек это переживает именно так.
 *
 * Отдельной функцией, потому что открытия считают в двух местах — по дням и по часам, — а
 * правило у них должно быть одно. Раньше по часам считались сырые события, и график
 * открытий показывал одни числа, а список рядом с ним другие.
 */
export function launchEvents(events: RawEvent[]): RawEvent[] {
  const out: RawEvent[] = [];
  let current: string | null = null;

  for (const event of [...events].sort((a, b) => a.timestampMs - b.timestampMs)) {
    if (event.type === "screenOff" || event.type === "keyguardShown" || event.type === "shutdown") {
      current = null;
      continue;
    }
    if (event.type !== "foreground") continue;
    const wasSame = current === event.packageName;
    current = event.packageName;
    if (!wasSame) out.push(event);
  }
  return out;
}

/** Сколько раз каждое приложение открывали, по дням. */
export function countLaunches(events: RawEvent[], rangeStartMs: number, rangeEndMs: number): Map<string, number> {
  const launches = new Map<string, number>();
  for (const event of launchEvents(events)) {
    // Окно проверяется после отбора: событие до его начала всё равно задаёт, что было
    // открыто, иначе первое утреннее приложение считалось бы открытым дважды.
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

/** Открытия по часам суток — тем же правилом, что и по дням. */
export function toHourlyLaunches(events: RawEvent[], rangeStartMs: number, rangeEndMs: number): HourlyValue[] {
  const counts = new Array<number>(24).fill(0);
  for (const event of launchEvents(events)) {
    if (event.timestampMs < rangeStartMs || event.timestampMs >= rangeEndMs) continue;
    counts[new Date(event.timestampMs).getHours()] += 1;
  }
  return counts.map((value, hour) => ({ hour, value }));
}

/**
 * Сколько раз телефон разблокировали, по дням.
 *
 * Считается событие «замок убран» — оно и означает разблокировку: ввёл пароль, приложил
 * палец, и экран блокировки ушёл. Это единственное число про телефон, которое человек
 * узнаёт: открытий рабочего стола за день бывают сотни, и ни одно из них он не помнит, а
 * «сколько раз я сегодня брался за телефон» — вопрос, на который хочется ответ.
 *
 * У кого блокировка не настроена вовсе, событий нет и число будет нулевым. Это честно:
 * разблокировок и правда не было.
 */
export function countUnlocks(events: RawEvent[], rangeStartMs: number, rangeEndMs: number): Map<string, number> {
  const unlocks = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "keyguardHidden") continue;
    if (event.timestampMs < rangeStartMs || event.timestampMs >= rangeEndMs) continue;
    const key = toDateKey(new Date(event.timestampMs));
    unlocks.set(key, (unlocks.get(key) ?? 0) + 1);
  }
  return unlocks;
}

/** Разблокировки по часам суток — для однодневного графика. */
export function toHourlyUnlocks(events: RawEvent[], rangeStartMs: number, rangeEndMs: number): HourlyValue[] {
  const counts = new Array<number>(24).fill(0);
  for (const event of events) {
    if (event.type !== "keyguardHidden") continue;
    if (event.timestampMs < rangeStartMs || event.timestampMs >= rangeEndMs) continue;
    counts[new Date(event.timestampMs).getHours()] += 1;
  }
  return counts.map((value, hour) => ({ hour, value }));
}

/**
 * Почасовая разность двух рядов, не уходящая в минус.
 *
 * Так получается «телефон»: всё экранное время минус то, что забрали приложения. Минус
 * здесь означал бы, что приложение было на переднем плане при погашенном экране, — такого
 * не бывает, но поток событий с пропущенным «экран погас» это изобразить может.
 */
export function subtractHourly(whole: HourlyValue[], part: HourlyValue[]): HourlyValue[] {
  return whole.map((h, i) => ({ hour: h.hour, value: Math.max(0, h.value - (part[i]?.value ?? 0)) }));
}

/** Только интервалы одного пакета — для почасового графика отдельного приложения. */
export function onlyPackage(intervals: Interval[], packageName: string): Interval[] {
  return intervals.filter((i) => i.packageName === packageName);
}
