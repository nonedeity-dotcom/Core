import { getCrekerAppUsage, getCrekerScreenTime, hasUsageAccess } from "../../modules/creker-usage";
import { api } from "../api/client";
import { perDayTarget } from "../lib/habits";
import { decideUsage, isTotal, type ScreenRule } from "../lib/screenTime";
import { dateNDaysAgo, shiftDate, todayKey } from "../lib/date";
import { normalizeAppDay, normalizeScreenDay, relabel } from "../lib/screen/usage";
import { resolveAppInfo, syncUsage } from "./usageSync";
import type { Habit, HabitLog } from "../types";

/**
 * Отмечает экранные привычки за день по данным, которые уже лежат у нас.
 *
 * Раньше такая привычка была одна, следила за всем экранным временем и спрашивала creker
 * напрямую. Теперь их может быть сколько угодно, и каждая смотрит на своё: одна на тикток,
 * другая на всё сразу. Поэтому и источник сменился на свою копию истории — в ней есть
 * разбивка по приложениям, и она переживёт удаление creker, ради чего её и завели.
 *
 * Молчаливый ноль — нормальное состояние, а не ошибка: нет экранных привычек, нет данных за
 * день, creker отстал и не может ручаться за «уложился» — всё это «делать нечего».
 *
 * Возвращает, сколько привычек действительно отметилось.
 */
export async function syncScreenHabits(habits: Habit[], date: string): Promise<number> {
  const watching = habits.filter((h) => h.auto === "screentime" && h.screen);
  if (watching.length === 0) return 0;

  // День человек мог отметить руками — это его день. Раньше снятая галочка «экранное время
  // в норме» держалась только до следующего захода на вкладку, где синхронизация тихо
  // ставила её обратно.
  const logs = (await api.getHabitLog(date, date)) as HabitLog[];
  const manual = new Set(logs.filter((l) => l.manual).map((l) => l.habitId));

  // Разбивка по приложениям читается только если она кому-то нужна: у привычки «всё
  // экранное время» она лишняя, а список приложений за день — самая длинная из этих таблиц.
  const needApps = watching.some((h) => !isTotal(h.screen as ScreenRule));
  const [days, apps] = await Promise.all([
    api.getScreenDays(date, date),
    needApps ? api.getScreenApps(date, date) : Promise.resolve([]),
  ]);

  /*
   * Отметка о свежести — одна на весь день, и берётся она из общей строки.
   *
   * У строки приложения своей нет: creker считает её тем же проходом, что и день целиком,
   * и отдельного «досчитано до» у неё не бывает. Значит, доверие к минутам тиктока — это
   * доверие к тому, докуда домерен день.
   */
  const day = days.find((d) => d.date === date);
  const updatedAt = day?.updatedAt ?? 0;
  const now = Date.now();

  let ticked = 0;
  for (const habit of watching) {
    if (manual.has(habit.id)) continue;
    // День до появления привычки ей не принадлежит: отметка там ничего не решает, зато
    // попала бы в награды за экран как день, который «удержался».
    if (habit.createdAt && date < habit.createdAt) continue;
    const rule = habit.screen as ScreenRule;
    const used = isTotal(rule)
      ? day?.screenMillis
      : apps.filter((a) => a.date === date && a.packageName === rule.app).reduce((n, a) => n + a.usageMillis, 0);
    // Нет строки дня вовсе — сказать нечего. А вот ноль минут в приложении, когда день
    // домерен, — это настоящий ответ: не открывал.
    if (used === undefined) continue;

    const verdict = decideUsage(used, updatedAt, rule.limitMin, now, date);
    if (verdict.action !== "tick") continue;

    // Привычка тут «да или нет», поэтому день пишется сразу полным или пустым, а не
    // шагами: ответ creker — это не нажатие.
    const perDay = perDayTarget(habit);
    await api.setHabitProgress(habit.id, date, verdict.withinLimit ? perDay : 0, perDay);
    ticked += 1;
  }

  return ticked;
}

/**
 * Как долго считать недавний пересчёт свежим.
 *
 * Пересчёт экранного времени зовут и Главная, и Sterzhen, и кнопка «обновить», а открытие
 * приложения обычно дёргает сразу двоих. Разбирать события за четыре дня дважды за секунду
 * незачем: минута — это меньше, чем меняется что-либо, что правило способно заметить.
 */
const REFRESH_FRESH_MS = 60_000;
let lastRefreshMs = 0;

/**
 * Обновить свою копию экранного времени.
 *
 * Своим замером, если система его разрешила, иначе — из Creker. Ошибка здесь не повод
 * ничего не делать дальше: правило посмотрит на то, что сохранено, и честно промолчит,
 * если сохранённое устарело.
 */
async function refreshScreenData(): Promise<void> {
  const now = Date.now();
  if (now - lastRefreshMs < REFRESH_FRESH_MS) return;
  lastRefreshMs = now;
  try {
    if (hasUsageAccess()) await syncUsage(now);
    else await syncFromCreker();
  } catch {
    // Не пересчиталось — отметка посмотрит на последнее сохранённое.
  }
}

/**
 * Обновить цифры и отметить экранные привычки — за сегодня и за вчера.
 *
 * Сначала обновление. Отметка читает свою копию истории, а копия сама не свежеет: её
 * пересчитывает Главная при открытии. Кто сразу уходил в Sterzhen, мог застать копию
 * вчерашней, и правило, которое не верит устаревшему «уложился», молча не ставило
 * галочку. Кнопка «обновить» по той же причине перестала обновлять экранное время —
 * хотя ради него она и была заведена.
 *
 * Потом — вчера. День заканчивается не тогда, когда приложение закрыли в восемь вечера:
 * до полуночи можно ещё просидеть в телефоне три часа. Если вечером было «уложился», а к
 * ночи лимит перевалил, вчерашняя галочка так и стояла бы — день судился бы по последнему
 * заходу, а не целиком. К утру вчерашние цифры окончательные, и день пересматривается.
 */
export async function refreshScreenHabits(habits: Habit[], today: string): Promise<number> {
  if (!habits.some((h) => h.auto === "screentime" && h.screen)) return 0;
  await refreshScreenData();
  const yesterday = await syncScreenHabits(habits, shiftDate(today, -1));
  const now = await syncScreenHabits(habits, today);
  return yesterday + now;
}

/**
 * Сколько минут ушло на то, за чем следит привычка, за этот день.
 *
 * Для строки в чек-листе: там нужно не «уложился или нет», а само число — «1 ч 12 мин из
 * 5 ч». `null` значит, что данных за день нет вовсе.
 */
export async function usedMinutes(rule: ScreenRule, date: string): Promise<number | null> {
  if (isTotal(rule)) {
    const days = await api.getScreenDays(date, date);
    const day = days.find((d) => d.date === date);
    return day ? Math.round(day.screenMillis / 60_000) : null;
  }
  const apps = await api.getScreenApps(date, date);
  const rows = apps.filter((a) => a.date === date && a.packageName === rule.app);
  const days = await api.getScreenDays(date, date);
  if (!days.some((d) => d.date === date)) return null;
  return Math.round(rows.reduce((n, a) => n + a.usageMillis, 0) / 60_000);
}

/**
 * Насколько далеко назад спрашивать creker при первом переносе.
 *
 * creker хранит всё, что когда-либо намерил, а сколько это — знает только он. Два года —
 * заведомо больше его возраста, и лишний запрос ничего не стоит: чего нет, того просто не
 * придёт в ответе.
 */
export const CREKER_HISTORY_DAYS = 730;

/**
 * Сколько дней перечитывать при обычной синхронизации.
 *
 * creker досчитывает сутки по мере того, как они идут, и правит вчерашний день утром. Брать
 * только сегодня значило бы навсегда сохранить у себя недосчитанное вчера.
 */
export const CREKER_REFRESH_DAYS = 14;

export interface CrekerSyncResult {
  /** Сколько дней и строк перенеслось. Ноль по обоим — creker молчит. */
  days: number;
  apps: number;
  /** Самый ранний перенесённый день, если он был. */
  earliest: string | null;
  /** Первый ли это перенос: по нему экран решает, что сказать человеку. */
  first: boolean;
}

/**
 * Переносит историю creker к себе.
 *
 * При первом запуске забирает всё, что у creker есть; дальше — последние две недели, потому
 * что старое уже лежит здесь и меняться не может, а свежее creker ещё правит.
 *
 * Молчаливый ноль — нормальное состояние, а не ошибка: creker может быть не установлен, не
 * пускать это приложение или быть слишком старым для пути с приложениями. Отличить одно от
 * другого умеет `getCrekerConnection` в нативном модуле, и это забота экрана, а не переноса.
 */
export async function syncFromCreker(): Promise<CrekerSyncResult> {
  const importedThrough = await api.getScreenImportedThrough();
  const first = importedThrough === null;
  const today = todayKey();
  const from = dateNDaysAgo(first ? CREKER_HISTORY_DAYS : CREKER_REFRESH_DAYS);

  const [rawDays, rawApps] = await Promise.all([
    getCrekerScreenTime(from, today),
    getCrekerAppUsage(from, today),
  ]);

  const days = rawDays
    .map((d) => normalizeScreenDay(d))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const rows = rawApps
    .map((a) => normalizeAppDay(a))
    .filter((a): a is NonNullable<typeof a> => a !== null);
  // Старые сборки creker отдавали только имя пакета — имя приложения там завелось позже.
  // Спросить систему дешевле, чем требовать от человека обновить creker ради названий.
  const cache = await resolveAppInfo(rows.map((r) => r.packageName));
  const apps = relabel(
    rows,
    Object.fromEntries(Object.entries(cache).map(([pkg, info]) => [pkg, info.label])),
  );

  const written = await api.mergeScreenData(days, apps);
  // Отметка ставится, только если что-то действительно пришло. Иначе первый запуск при
  // недоступном creker записал бы «уже перенесли», и настоящая история никогда бы не
  // приехала — следующий раз забирал бы только две недели.
  if (written.days > 0 || written.apps > 0) await api.setScreenImportedThrough(today);

  const earliest = days.reduce<string | null>((min, d) => (!min || d.date < min ? d.date : min), null);
  return { days: written.days, apps: written.apps, earliest, first };
}
