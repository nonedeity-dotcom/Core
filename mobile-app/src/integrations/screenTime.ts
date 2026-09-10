import { getCrekerAppUsage, getCrekerScreenTime } from "../../modules/creker-usage";
import { api } from "../api/client";
import { perDayTarget } from "../lib/habits";
import { decideScreenTimeHabit } from "../lib/screenTime";
import { dateNDaysAgo, todayKey } from "../lib/date";
import { normalizeAppDay, normalizeScreenDay, relabel } from "../lib/screen/usage";
import { resolveAppInfo } from "./usageSync";
import type { Habit, HabitLog } from "../types";

/**
 * Auto-ticks (or un-ticks) the "screentime" habit for `date` from creker's data,
 * if that habit exists and creker's number for the day is one we can stand behind
 * — see decideScreenTimeHabit for that rule. Silent no-op otherwise: no creker
 * installed, nothing synced yet, a row creker hasn't caught up on, or no
 * screen-time habit are all the same "nothing to do" case, not errors. Habits
 * without `auto: "screentime"` are untouched, so everything else — and this one,
 * on days creker can't speak for — stays manual.
 *
 * Returns whether the habit's state was actually set from creker's data.
 */
export async function syncScreenTimeHabit(habits: Habit[], date: string): Promise<boolean> {
  const target = habits.find((h) => h.auto === "screentime");
  if (!target) return false;

  // A day the person set by hand is theirs: unticking "экранное время в норме" used to last
  // only until the next visit to the tab, when this sync quietly put it back.
  const logs = (await api.getHabitLog(date, date)) as HabitLog[];
  if (logs.some((l) => l.habitId === target.id && l.manual)) return false;

  const rows = await getCrekerScreenTime(date, date);
  const row = rows.find((r) => r.date === date);
  if (!row) return false;

  const limitMin = await api.getScreenTimeLimitMinutes();
  const verdict = decideScreenTimeHabit(row, limitMin, Date.now(), date);
  if (verdict.action !== "tick") return false;

  // The auto habit is a plain yes/no, so its day is written straight to full or empty
  // rather than stepped: creker's answer is not a tap.
  const perDay = perDayTarget(target);
  await api.setHabitProgress(target.id, date, verdict.withinLimit ? perDay : 0, perDay);
  return true;
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
 * другого умеет `getCrekerConnection`, и это забота экрана, а не переноса.
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
