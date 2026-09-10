import { api, type AppInfoEntry } from "../api/client";
import { dateNDaysAgo, todayKey } from "../lib/date";
import { getAppInfo, hasUsageAccess, queryRawEvents } from "../../modules/creker-usage";
import {
  buildIntervals,
  buildScreenOnIntervals,
  clipIntervals,
  countLaunches,
  countUnlocks,
  launchEvents,
  measuredThroughMs,
  onlyPackage,
  subtractHourly,
  toDailyUsage,
  toHourlyLaunches,
  toHourlyUnlocks,
  toHourlyUsage,
  type HourlyValue,
} from "../lib/screen/sessions";
import type { AppDay, ScreenDay } from "../lib/screen/usage";
import { isEmptyHourlyDay, seriesFor, type HourlyDay } from "../lib/screen/hours";

/**
 * Приложение считает экранное время само.
 *
 * Сырые события даёт система, а весь смысл им придаётся здесь — в коде, покрытом тестами.
 * Нативная часть только пересказывает поток событий и ничего не решает.
 */

/**
 * Насколько далеко назад пересобирать при каждой синхронизации.
 *
 * Система хранит подробные события считанные дни, поэтому глубже лезть бессмысленно: за
 * этой границей событий уже нет, и попытка пересчитать день превратила бы его в ноль.
 * Именно поэтому и нужна своя копия — то, что уже посчитано, остаётся посчитанным.
 */
export const REBUILD_DAYS = 4;

/**
 * Запас назад при запросе событий.
 *
 * Сессия могла начаться до начала окна: без запаса она потерялась бы целиком, а не
 * обрезалась. Шесть часов покрывают ночь с телефоном в руке и всё, что короче.
 */
export const SESSION_LOOKBACK_MS = 6 * 60 * 60 * 1000;

export interface UsageSyncResult {
  /** Сколько дней пересчитано. */
  days: number;
  /** Сколько событий прочитано. Ноль при выданном доступе значит «ничего не происходило». */
  events: number;
  /** Нет доступа — считать нечем, и это единственная причина, требующая действия человека. */
  denied: boolean;
}

/**
 * Дособрать справочник приложений: что не знаем — спросить у системы.
 *
 * Возвращается весь справочник целиком, а не только новое: тем, кто зовёт, нужно имя для
 * каждого пакета, а не список того, чего не хватало.
 *
 * Пере-спрашиваются и те, о ком уже что-то знаем, но не знаем главного: запись, сделанная
 * до появления признака домашнего экрана, иначе осталась бы без него навсегда — имя и
 * иконка у неё есть, и за новыми она бы никогда не пошла.
 *
 * Без доступа к системе спрашивать некого, и справочник возвращается как есть: загруженная
 * из файла история тогда покажет имена пакетов, но покажет.
 */
export async function resolveAppInfo(packages: string[]): Promise<Record<string, AppInfoEntry>> {
  const cache = await api.getAppInfoCache();
  const unknown = [...new Set(packages)].filter((p) => !cache[p] || cache[p].isHome === undefined);
  if (unknown.length === 0) return cache;

  const fresh = await getAppInfo(unknown);
  if (fresh.length === 0) return cache;

  await api.saveAppInfo(
    fresh.map((f) => ({
      packageName: f.packageName,
      label: f.label,
      icon: f.icon,
      installedAtMs: f.installedAtMs,
      isHome: f.isHome,
    })),
  );
  for (const f of fresh) {
    cache[f.packageName] = {
      label: f.label,
      icon: f.icon,
      installedAtMs: f.installedAtMs,
      isHome: f.isHome,
    };
  }
  return cache;
}

/**
 * Пересчитывает последние дни из системных событий и кладёт результат к себе.
 *
 * Пустой поток событий не стирает уже сохранённое: пусто бывает и когда ничего не
 * происходило, и когда доступ отобрали, а разница между «нулевой день» и «день, который
 * никто не мерил» — это ровно то, ради чего хранится отметка досчитанности.
 */
/** Ряд из двадцати четырёх чисел — то, что хранится, вместо пар «час — значение». */
const values = (row: HourlyValue[]): number[] => row.map((h) => h.value);

export async function syncUsage(nowMs = Date.now()): Promise<UsageSyncResult> {
  if (!hasUsageAccess()) return { days: 0, events: 0, denied: true };

  const today = todayKey();
  const firstDay = dateNDaysAgo(REBUILD_DAYS - 1);
  const [y, m, d] = firstDay.split("-").map(Number);
  const windowStartMs = new Date(y, m - 1, d).getTime();

  const events = await queryRawEvents(windowStartMs - SESSION_LOOKBACK_MS, nowMs);
  if (events.length === 0) return { days: 0, events: 0, denied: false };

  const intervals = buildIntervals(events, windowStartMs, nowMs, nowMs);
  const launches = countLaunches(events, windowStartMs, nowMs);
  const appRows = toDailyUsage(intervals, launches);

  const screenIntervals = buildScreenOnIntervals(events, windowStartMs, nowMs, nowMs);
  const screenRows = toDailyUsage(screenIntervals);

  const unlocks = countUnlocks(events, windowStartMs, nowMs);
  const days: ScreenDay[] = screenRows.map((row) => ({
    date: row.date,
    screenMillis: row.usageMillis,
    updatedAt: measuredThroughMs(row.date, nowMs),
    unlocks: unlocks.get(row.date) ?? 0,
  }));

  // Названия берутся из кэша, а недостающие — у системы. Иконка рисуется один раз на
  // приложение, а не на каждый показ списка.
  const cache = await resolveAppInfo(appRows.map((r) => r.packageName));

  // Почасовая картина считается здесь же, пока события ещё живы, и сохраняется рядом с
  // итогом дня: система держит подробные события считанные дни, а посмотреть на прошлый
  // месяц по часам хочется и позже. Домашний экран отделяется тем же справочником, что и
  // в дневных числах, — иначе график и список разошлись бы.
  const home = new Set(
    Object.entries(cache)
      .filter(([, info]) => info.isHome)
      .map(([packageName]) => packageName),
  );
  const opened = launchEvents(events).filter((e) => !home.has(e.packageName));
  const hours: HourlyDay[] = [];
  for (let back = REBUILD_DAYS - 1; back >= 0; back--) {
    const date = dateNDaysAgo(back);
    const [dy, dm, dd] = date.split("-").map(Number);
    const dayStart = new Date(dy, dm - 1, dd).getTime();
    const dayEnd = new Date(dy, dm - 1, dd + 1).getTime();
    const day: HourlyDay = {
      date,
      screen: values(toHourlyUsage(clipIntervals(screenIntervals, dayStart, dayEnd))),
      apps: values(toHourlyUsage(clipIntervals(intervals.filter((i) => !home.has(i.packageName)), dayStart, dayEnd))),
      launches: values(toHourlyLaunches(opened, dayStart, dayEnd)),
      unlocks: values(toHourlyUnlocks(events, dayStart, dayEnd)),
    };
    if (!isEmptyHourlyDay(day)) hours.push(day);
  }
  await api.mergeHourlyDays(hours);

  const apps: AppDay[] = appRows.map((row) => ({
    date: row.date,
    packageName: row.packageName,
    label: cache[row.packageName]?.label ?? row.packageName,
    usageMillis: row.usageMillis,
    launchCount: row.launchCount,
  }));

  const written = await api.mergeScreenData(days, apps);
  await api.setUsageLastSync(nowMs);
  return { days: Math.max(written.days, days.length), events: events.length, denied: false };
}

/**
 * Чьё время показывать.
 *
 * «Общий» — всё, что было на включённом экране. «Приложения» — то, что человек выбирал
 * открыть. «Телефон» — всё остальное: рабочий стол, шторка, «недавние», переходы между
 * приложениями. Ровно две части и их сумма, поэтому числа сходятся без оговорок.
 */
export type Scope = "all" | "apps" | "phone";

export const SCOPE_LABELS: Record<Scope, string> = {
  all: "Общий",
  apps: "Приложения",
  phone: "Телефон",
};

/** Что рисует график: время или открытия. Крупные числа показываются оба сразу. */
export type Metric = "time" | "launches";

export const METRIC_LABELS: Record<Metric, string> = {
  time: "Время",
  launches: "Заходы",
};

/** Два ряда одного дня: время и заходы в тех же часах. */
export interface HourlySeries {
  time: HourlyValue[];
  launches: HourlyValue[];
}

/**
 * Почасовая разбивка одного дня — время и заходы сразу.
 *
 * Оба ряда вместе, а не по одному на запрос: они рисуются на одном графике, считаются из
 * одних и тех же событий, и делить их значило бы дважды сходить за одним и тем же.
 *
 * Сначала спрашивается хранилище: разбивка посчитана в тот день, когда события были живы, и
 * с тех пор лежит рядом с итогом. Дальше — живые события, для дня, который ещё не успели
 * посчитать, и для отдельного приложения: по приложениям почасовая история не хранится.
 *
 * Для дня, о котором не знает ни хранилище, ни система, честный ответ — `null`, а не
 * двадцать четыре нуля: разница между «в эти часы не пользовался» и «эти часы никто не
 * помнит» здесь и есть весь смысл.
 *
 * «Телефон» считается вычитанием: всё экранное время минус то, что забрали приложения. Это
 * то же определение, что и в дневных числах, — иначе график и список говорили бы разное.
 */
export async function hourlyFor(
  date: string,
  scope: Scope,
  homePackages: string[] = [],
  packageName?: string,
): Promise<HourlySeries | null> {
  if (!packageName) {
    const stored = await api.getHourlyDay(date);
    if (stored) {
      return { time: seriesFor(stored, scope, "time"), launches: seriesFor(stored, scope, "launches") };
    }
  }
  if (!hasUsageAccess()) return null;
  const [y, m, d] = date.split("-").map(Number);
  const startMs = new Date(y, m - 1, d).getTime();
  const endMs = new Date(y, m - 1, d + 1).getTime();
  const nowMs = Date.now();
  if (startMs > nowMs) return null;

  const events = await queryRawEvents(startMs - SESSION_LOOKBACK_MS, Math.min(endMs, nowMs));
  if (events.length === 0) return null;
  const home = new Set(homePackages);

  const foreground = buildIntervals(events, startMs, endMs, nowMs);
  const opened = launchEvents(events).filter((e) =>
    packageName ? e.packageName === packageName : !home.has(e.packageName),
  );
  // Отбор уже сделан, дедупликация внутри повторно ничего не изменит.
  const appLaunches = toHourlyLaunches(opened, startMs, endMs);
  const unlocks = toHourlyUnlocks(events, startMs, endMs);

  if (packageName) {
    return { time: toHourlyUsage(onlyPackage(foreground, packageName)), launches: appLaunches };
  }

  const apps = toHourlyUsage(foreground.filter((i) => !home.has(i.packageName)));
  if (scope === "apps") return { time: apps, launches: appLaunches };

  const screen = toHourlyUsage(buildScreenOnIntervals(events, startMs, endMs, nowMs));
  // У «телефона» заходы — это разблокировки, а у «общего» — заходы в приложения плюс они
  // же: ровно так же, как считаются крупные числа над графиком.
  if (scope === "phone") return { time: subtractHourly(screen, apps), launches: unlocks };
  return {
    time: screen,
    launches: appLaunches.map((h, i) => ({ hour: h.hour, value: h.value + (unlocks[i]?.value ?? 0) })),
  };
}
