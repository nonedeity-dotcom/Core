import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { RawEvent } from "../../src/lib/screen/sessions";

export interface CrekerUsageDay {
  date: string;
  screenMillis: number;
  /**
   * Epoch millis up to which `screenMillis` is complete for that day — creker's
   * own contract calls this `updated_at`, and it is *not* the moment the row was
   * written. `0` means unknown (a creker build older than the column, or a day it
   * never finished measuring). Without this, a row that reads 0 ms is
   * indistinguishable from a day creker hasn't caught up on yet.
   */
  updatedAt: number;
}

/** One app's foreground time on one day, as creker recorded it. */
export interface CrekerAppDay {
  date: string;
  packageName: string;
  /**
   * Readable name, resolved by creker rather than here: since Android 11 an app sees only the
   * packages it declared up front, so this app cannot turn `com.google.android.youtube` into
   * «YouTube» itself. Falls back to the package name.
   */
  label: string;
  usageMillis: number;
  launchCount: number;
}

/** Название и иконка пакета, как их видит система прямо сейчас. */
export interface AppInfo {
  packageName: string;
  label: string;
  installed: boolean;
  /** PNG как data-URI, либо null: приложение удалено или иконку не удалось нарисовать. */
  icon: string | null;
}

interface CrekerUsageNativeModule {
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): boolean;
  queryRawEvents(startMs: number, endMs: number): Promise<RawEvent[]>;
  getAppInfo(packages: string[]): Promise<AppInfo[]>;
  getScreenTime(fromDate: string, toDate: string): Promise<CrekerUsageDay[]>;
  getAppUsage(fromDate: string, toDate: string): Promise<CrekerAppDay[]>;
  getStatus(date: string): Promise<{
    installed: boolean;
    answered: boolean;
    denied: boolean;
    screenMillis?: number | null;
    updatedAt?: number | null;
  }>;
}

/**
 * Why there is no screen-time data, when there is none.
 *
 * getCrekerScreenTime flattens every failure into an empty list, which is right for the
 * habit tick — a missing creker is a normal state, not an error — but useless to someone
 * asking "is this working at all". These are the four answers worth telling apart:
 *
 * - not-installed: creker's provider isn't on this device
 * - refused: creker is here but won't answer us — the user hasn't allowed this app in
 *   creker's settings, or the permission isn't held
 * - silent: installed and not refusing, but the query failed anyway
 * - connected: it answered; `screenMillis` is null when it has no row for that day
 */
export type CrekerConnection =
  | { state: "not-installed" }
  | { state: "refused" }
  | { state: "silent" }
  | { state: "connected"; screenMillis: number | null; updatedAt: number | null };

// requireOptionalNativeModule (not requireNativeModule) — returns null instead of
// throwing when the module isn't linked (e.g. this file imported outside a native
// build), so callers don't need their own try/catch just to guard against that.
const native = Platform.OS === "android" ? requireOptionalNativeModule<CrekerUsageNativeModule>("CrekerUsage") : null;

/**
 * Screen time for [fromDate, toDate] ("yyyy-MM-dd", inclusive) from creker, a
 * separate screen-time tracker app on the same device — see modules/creker-usage's
 * native side and creker's own UsageProvider for how this actually reaches across
 * apps. Resolves to [] (never rejects) whenever creker isn't installed or has no
 * data for the range — that's the expected common case, not a failure.
 */
export async function getCrekerScreenTime(fromDate: string, toDate: string): Promise<CrekerUsageDay[]> {
  if (!native) return [];
  try {
    const rows = await native.getScreenTime(fromDate, toDate);
    // Older native side / older creker may omit updatedAt entirely; normalise it
    // here so every caller can treat the field as present and 0 as "unknown".
    return rows.map((row) => ({ ...row, updatedAt: Number(row.updatedAt) || 0 }));
  } catch {
    return [];
  }
}

/**
 * Per-app foreground time for a range, from creker.
 *
 * Resolves to [] for every failure, exactly like getCrekerScreenTime — and here that
 * includes a creker too old to have this path at all, which is what every already-installed
 * creker is. So an empty list means "nothing to show", never "something is broken", and the
 * caller must be able to tell the difference some other way if it needs to.
 */
export async function getCrekerAppUsage(fromDate: string, toDate: string): Promise<CrekerAppDay[]> {
  if (!native) return [];
  try {
    const rows = await native.getAppUsage(fromDate, toDate);
    return rows.map((row) => ({
      date: String(row.date),
      packageName: String(row.packageName),
      label: String(row.label || row.packageName),
      usageMillis: Number(row.usageMillis) || 0,
      launchCount: Number(row.launchCount) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * The same query as getCrekerScreenTime, asked for one day and reported honestly —
 * see [CrekerConnection]. Off Android there is nothing to ask, which reads the same as
 * creker not being installed.
 */
export async function getCrekerConnection(date: string): Promise<CrekerConnection> {
  if (!native) return { state: "not-installed" };
  try {
    const status = await native.getStatus(date);
    if (!status.installed) return { state: "not-installed" };
    if (status.denied) return { state: "refused" };
    if (!status.answered) return { state: "silent" };
    return {
      state: "connected",
      screenMillis: status.screenMillis == null ? null : Number(status.screenMillis),
      updatedAt: status.updatedAt == null ? null : Number(status.updatedAt),
    };
  } catch {
    // An older native side without getStatus at all lands here, and "installed but not
    // answering" is exactly what that is from the outside.
    return { state: "silent" };
  }
}

/**
 * Есть ли у приложения доступ к статистике использования.
 *
 * Это не обычное разрешение, а особое: его нельзя запросить диалогом, только открыть
 * системный экран и попросить человека включить переключатель. Вне Android — всегда нет, и
 * это читается так же, как «не выдано».
 */
export function hasUsageAccess(): boolean {
  if (!native || Platform.OS !== "android") return false;
  try {
    return native.hasUsageAccess();
  } catch {
    return false;
  }
}

/** Открывает системный экран выдачи доступа. false — открыть не удалось. */
export function openUsageAccessSettings(): boolean {
  if (!native) return false;
  try {
    return native.openUsageAccessSettings();
  } catch {
    return false;
  }
}

/**
 * Сырой поток системных событий за окно.
 *
 * Ничего не истолковано: смысл этим событиям придаёт `lib/screen/sessions`, и придаёт его
 * там, где это проверяется тестами.
 */
export async function queryRawEvents(startMs: number, endMs: number): Promise<RawEvent[]> {
  if (!native) return [];
  try {
    return await native.queryRawEvents(startMs, endMs);
  } catch {
    return [];
  }
}

/** Названия и иконки пакетов. Пустой список — нативной части нет или система молчит. */
export async function getAppInfo(packages: string[]): Promise<AppInfo[]> {
  if (!native || packages.length === 0) return [];
  try {
    return await native.getAppInfo(packages);
  } catch {
    return [];
  }
}
