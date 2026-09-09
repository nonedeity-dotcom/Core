import { api } from "../api/client";
import { dateNDaysAgo, todayKey } from "../lib/date";
import { getAppInfo, hasUsageAccess, queryRawEvents } from "../../modules/creker-usage";
import {
  buildIntervals,
  buildScreenOnIntervals,
  countLaunches,
  measuredThroughMs,
  launchEvents,
  onlyPackage,
  subtractHourly,
  toDailyUsage,
  toHourlyLaunches,
  toHourlyUsage,
  type HourlyValue,
} from "../lib/screen/sessions";
import type { AppDay, ScreenDay } from "../lib/screen/usage";

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
 * Пересчитывает последние дни из системных событий и кладёт результат к себе.
 *
 * Пустой поток событий не стирает уже сохранённое: пусто бывает и когда ничего не
 * происходило, и когда доступ отобрали, а разница между «нулевой день» и «день, который
 * никто не мерил» — это ровно то, ради чего хранится отметка досчитанности.
 */
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

  const days: ScreenDay[] = screenRows.map((row) => ({
    date: row.date,
    screenMillis: row.usageMillis,
    updatedAt: measuredThroughMs(row.date, nowMs),
  }));

  // Названия берутся из кэша, а недостающие — у системы. Иконка рисуется один раз на
  // приложение, а не на каждый показ списка.
  const cache = await api.getAppInfoCache();
  // Пере-спрашиваются и те, о ком уже что-то знаем, но не знаем главного: запись,
  // сделанная до появления признака домашнего экрана, иначе осталась бы без него навсегда —
  // имя и иконка у неё есть, и за новыми она бы никогда не пошла.
  const unknown = [...new Set(appRows.map((r) => r.packageName))].filter(
    (p) => !cache[p] || cache[p].isHome === undefined,
  );
  if (unknown.length > 0) {
    const fresh = await getAppInfo(unknown);
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
  }

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

/**
 * Почасовая разбивка одного дня.
 *
 * Считается на лету из системных событий, а не берётся из хранилища: подробные события
 * система держит считанные дни, и почасовая картина существует ровно для них. Для дня, по
 * которому событий уже нет, честный ответ — `null`, а не двадцать четыре нуля: разница между
 * «в эти часы не пользовался» и «эти часы никто не помнит» здесь и есть весь смысл.
 *
 * «Телефон» считается вычитанием: всё экранное время минус то, что забрали приложения. Это
 * то же определение, что и в дневных числах, — иначе график и список говорили бы разное.
 */
export async function hourlyFor(
  date: string,
  scope: Scope,
  metric: Metric,
  homePackages: string[] = [],
  packageName?: string,
): Promise<HourlyValue[] | null> {
  if (!hasUsageAccess()) return null;
  const [y, m, d] = date.split("-").map(Number);
  const startMs = new Date(y, m - 1, d).getTime();
  const endMs = new Date(y, m - 1, d + 1).getTime();
  const nowMs = Date.now();
  if (startMs > nowMs) return null;

  const events = await queryRawEvents(startMs - SESSION_LOOKBACK_MS, Math.min(endMs, nowMs));
  if (events.length === 0) return null;
  const home = new Set(homePackages);

  if (metric === "launches") {
    const opened = launchEvents(events).filter((e) => {
      if (packageName) return e.packageName === packageName;
      if (scope === "apps") return !home.has(e.packageName);
      if (scope === "phone") return home.has(e.packageName);
      return true;
    });
    // Отбор уже сделан, дедупликация внутри повторно ничего не изменит.
    return toHourlyLaunches(opened, startMs, endMs);
  }

  const foreground = buildIntervals(events, startMs, endMs, nowMs);
  if (packageName) return toHourlyUsage(onlyPackage(foreground, packageName));

  const apps = toHourlyUsage(foreground.filter((i) => !home.has(i.packageName)));
  if (scope === "apps") return apps;

  const screen = toHourlyUsage(buildScreenOnIntervals(events, startMs, endMs, nowMs));
  return scope === "all" ? screen : subtractHourly(screen, apps);
}
