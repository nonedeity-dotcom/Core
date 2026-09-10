import {
  BACKUP_FORMAT_VERSION,
  DEFAULT_FOCUS_INTERVALS,
  exportData,
  mergeData,
  replaceData,
  type BackupData,
  type FocusIntervals,
  type ImportStats,
} from "../api/client";
import {
  getReminderSettings,
  normalizeSettings,
  setReminderSettings,
  type ReminderSettings,
} from "../notifications/reminders";
import { toDateKey } from "./date";
import { normalizeDayRule } from "./dayRule";
import { normalizeSkipRule } from "./skipRule";
import { normalizeTipPrefs } from "./tipLibrary";
import { normalizeLateRule, normalizeSchedule } from "./habitSchedule";
import { normalizeProfile } from "./balance/profile";
import { normalizeDish, normalizeEntry, normalizeProduct } from "./balance/food";
import { normalizeWeightEntry } from "./balance/weight";
import { normalizeWaterDay } from "./balance/water";
import { normalizeHourlyDay } from "./screen/hours";
import { normalizeAppDay, normalizeScreenDay } from "./screen/usage";
import type {
  Habit,
  HabitTarget,
  ItemGroup,
  HabitLog,
  EnergyLog,
  FocusSession,
  RewardOption,
  Reward,
  Task,
  WeeklyReview,
} from "../types";

/** Marks the file as ours, so a random .json picked by mistake is rejected. */
const APP_ID = "no-burnout";

/**
 * Что именно лежит в файле.
 *
 * Копия бывает общей и отдельной: один раздел — один файл. Разделять полезно ровно потому,
 * что разделы независимы: перенести еду на другой телефон, не трогая тамошние привычки, —
 * обычное желание, а общая копия такого не умеет.
 *
 * Файл всегда одной и той же формы, чужие разделы в нём просто пусты. Так старое
 * приложение прочитает новый файл, а новое — старый: отсутствие поля и пустое поле здесь
 * значат одно и то же.
 */
export type BackupScope = "all" | "sterzhen" | "calorix" | "creker";

export const SCOPE_LABELS: Record<BackupScope, string> = {
  all: "Все данные",
  sterzhen: "Sterzhen",
  calorix: "CaloriX",
  creker: "Creker",
};

/** Поля, которые принадлежат разделу. Всё, чего нет ни в одном, — общее и едет с «Sterzhen». */
const SCOPE_FIELDS: Record<Exclude<BackupScope, "all">, (keyof BackupData)[]> = {
  sterzhen: [
    "habits",
    "habitLog",
    "energy",
    "sessions",
    "milestones",
    "freezes",
    "rewardOptions",
    "rewards",
    "reviews",
    "tasks",
    "screenTimeLimitMinutes",
    "focusIntervals",
    "dayRule",
    "skipRule",
    "habitFreezes",
    "tipPrefs",
    "lateRule",
  ],
  calorix: [
    "balanceProfile",
    "balanceProducts",
    "balanceFoodLog",
    "balanceDishes",
    "balanceWeight",
    "balanceWater",
  ],
  creker: ["screenDays", "screenApps", "screenHours"],
};

export interface BackupFile {
  app: typeof APP_ID;
  formatVersion: number;
  exportedAt: string;
  /** Отсутствует в файлах, записанных до раздельных копий: они всегда были общими. */
  scope: BackupScope;
  data: BackupData;
  reminder: ReminderSettings;
}

export type ImportMode = "merge" | "replace";

/** A problem with the file itself; `message` is shown to the user as-is. */
export class BackupError extends Error {}

export function backupFileName(now = new Date(), scope: BackupScope = "all"): string {
  const prefix = scope === "all" ? APP_ID : scope;
  return `${prefix}-${toDateKey(now)}.json`;
}

/** Пустая копия — форма файла без единой записи; в неё вкладывается только нужный раздел. */
function emptyData(): BackupData {
  return {
    habits: [],
    habitLog: [],
    energy: [],
    sessions: [],
    milestones: [],
    freezes: [],
    rewardOptions: [],
    rewards: [],
    reviews: [],
    tasks: [],
    screenTimeLimitMinutes: 180,
    focusIntervals: DEFAULT_FOCUS_INTERVALS,
    dayRule: normalizeDayRule(undefined),
    skipRule: normalizeSkipRule(undefined),
    habitFreezes: {},
    tipPrefs: normalizeTipPrefs(undefined),
    lateRule: normalizeLateRule(undefined),
    balanceProfile: null,
    balanceProducts: [],
    balanceFoodLog: [],
    balanceDishes: [],
    balanceWeight: [],
    balanceWater: [],
    screenDays: [],
    screenApps: [],
    screenHours: [],
  };
}

/** Оставить в копии только один раздел, остальные — пустыми. */
function narrow(data: BackupData, scope: BackupScope): BackupData {
  if (scope === "all") return data;
  const out = emptyData();
  for (const field of SCOPE_FIELDS[scope]) {
    (out as unknown as Record<string, unknown>)[field] = data[field];
  }
  return out;
}

/** Положить поля раздела из копии поверх того, что уже есть. Остальное остаётся своим. */
function overlay(current: BackupData, incoming: BackupData, scope: Exclude<BackupScope, "all">): BackupData {
  const out = { ...current };
  for (const field of SCOPE_FIELDS[scope]) {
    (out as unknown as Record<string, unknown>)[field] = incoming[field];
  }
  return out;
}

/** The exact text that gets written to the file. */
export async function buildBackupText(scope: BackupScope = "all"): Promise<string> {
  const [data, reminder] = await Promise.all([exportData(), getReminderSettings()]);
  const file: BackupFile = {
    app: APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    data: narrow(data, scope),
    reminder,
  };
  // Indented: the file is small and a person may well open it in a text editor.
  return JSON.stringify(file, null, 2);
}

// --- validation -------------------------------------------------------------
//
// The file comes from the user's storage, so it can be anything: another app's
// export, a truncated download, a hand-edited copy. Every field is checked
// before a single byte is written, and a bad entry is dropped rather than
// allowed to blow up a screen later.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDateKey = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickValid<T>(value: unknown, keep: (row: Record<string, unknown>, index: number) => T | null): T[] {
  const out: T[] = [];
  list(value).forEach((row, index) => {
    if (!isObj(row)) return;
    const parsed = keep(row, index);
    if (parsed) out.push(parsed);
  });
  return out;
}

function isGroup(v: unknown): v is ItemGroup {
  return v === "now" || v === "extra" || v === "later";
}

/** Anything unreadable becomes the old meaning of a habit: once a day. */
function parseTarget(raw: unknown): HabitTarget {
  if (typeof raw !== "object" || raw === null) return { kind: "daily", count: 1 };
  const o = raw as Record<string, unknown>;
  const kind = o.kind === "weekly" ? "weekly" : "daily";
  const count = isNum(o.count) ? Math.min(12, Math.max(1, Math.round(o.count))) : 1;
  return { kind, count };
}

function parseData(raw: unknown): BackupData {
  const d = isObj(raw) ? raw : {};

  const habits = pickValid<Habit>(d.habits, (h, index) =>
    isStr(h.id) && isStr(h.label)
      ? {
          id: h.id,
          label: h.label,
          hint: isStr(h.hint) ? h.hint : null,
          minimal: isStr(h.minimal) ? h.minimal : null,
          sortOrder: isNum(h.sortOrder) ? h.sortOrder : index,
          // Absent in files written before the split and the targets — an old habit was one
          // you were doing, once a day.
          group: isGroup(h.group) ? h.group : "now",
          target: parseTarget(h.target),
          auto: h.auto === "screentime" ? "screentime" : null,
          // Carried through rather than rebuilt from the parts above. Without these a
          // restore quietly undid three of the rules the streak runs on: an undated habit
          // judges nothing, one that lost `nowSince` starts answering for the days it spent
          // outside the checklist again, and an archived one walks back into it.
          ...(isDateKey(h.createdAt) ? { createdAt: h.createdAt } : {}),
          ...(isDateKey(h.nowSince) ? { nowSince: h.nowSince } : {}),
          ...(isStr(h.archivedAt) ? { archivedAt: h.archivedAt } : {}),
          ...(normalizeSchedule(h.schedule) ? { schedule: normalizeSchedule(h.schedule) } : {}),
        }
      : null,
  );

  const habitLog = pickValid<HabitLog>(d.habitLog, (l) =>
    isStr(l.habitId) && isDateKey(l.date)
      ? {
          id: isStr(l.id) ? l.id : `${l.habitId}-${l.date}`,
          habitId: l.habitId,
          date: l.date,
          done: l.done === true,
          // A row from before counters recorded only "done", which was one.
          count: isNum(l.count) ? Math.max(0, Math.trunc(l.count)) : l.done === true ? 1 : 0,
          minimal: l.done === true && l.minimal === true,
        }
      : null,
  );


  const energy = pickValid<EnergyLog>(d.energy, (e) =>
    isDateKey(e.date) && isNum(e.hour) && isNum(e.value)
      ? { date: e.date, hour: Math.trunc(e.hour), value: Math.trunc(e.value) }
      : null,
  );

  const sessions = pickValid<FocusSession>(d.sessions, (s) =>
    isStr(s.id) && isDateKey(s.date) && isNum(s.durationMin)
      ? {
          id: s.id,
          date: s.date,
          durationMin: s.durationMin,
          completedAt: isStr(s.completedAt) ? s.completedAt : `${s.date}T00:00:00.000Z`,
        }
      : null,
  );


  const rewardOptions = pickValid<RewardOption>(d.rewardOptions, (o) =>
    isStr(o.id) && isStr(o.label) ? { id: o.id, label: o.label } : null,
  );

  const rewards = pickValid<Reward>(d.rewards, (r) =>
    isStr(r.id) && isDateKey(r.date) && isStr(r.text) ? { id: r.id, date: r.date, text: r.text } : null,
  );

  const reviews = pickValid<WeeklyReview>(d.reviews, (r) =>
    isStr(r.week) && isDateKey(r.date)
      ? {
          week: r.week,
          date: r.date,
          worked: isStr(r.worked) ? r.worked : "",
          didnt: isStr(r.didnt) ? r.didnt : "",
          change: isStr(r.change) ? r.change : "",
        }
      : null,
  );

  const tasks = pickValid<Task>(d.tasks, (t) =>
    isStr(t.id) && isStr(t.label)
      ? { id: t.id, label: t.label, kind: t.kind === "routine" ? "routine" : "hard", done: t.done === true }
      : null,
  );

  const milestones = list(d.milestones).filter(isNum);
  // Absent in files written before freezes existed, which must still import.
  const freezes = list(d.freezes).filter(isDateKey);

  const limit = isNum(d.screenTimeLimitMinutes) && d.screenTimeLimitMinutes > 0 ? d.screenTimeLimitMinutes : 180;

  // Bad values are dropped rather than clamped here — client.setFocusIntervals
  // clamps again on write, so a garbage pair can't reach the timer either way.
  const fi = isObj(d.focusIntervals) ? d.focusIntervals : {};
  const focusIntervals: FocusIntervals = {
    // Missing from every backup written before the boredom phase existed.
    boredomMin:
      isNum(fi.boredomMin) && fi.boredomMin > 0 ? Math.round(fi.boredomMin) : DEFAULT_FOCUS_INTERVALS.boredomMin,
    workMin: isNum(fi.workMin) && fi.workMin > 0 ? Math.round(fi.workMin) : DEFAULT_FOCUS_INTERVALS.workMin,
    breakMin: isNum(fi.breakMin) && fi.breakMin > 0 ? Math.round(fi.breakMin) : DEFAULT_FOCUS_INTERVALS.breakMin,
  };

  return {
    habits,
    habitLog,
    energy,
    sessions,
    milestones,
    freezes,
    rewardOptions,
    rewards,
    reviews,
    tasks,
    screenTimeLimitMinutes: limit,
    focusIntervals,
    // Missing from every file written before the day rule was settable; normalizeDayRule
    // turns anything it does not recognise into the default.
    dayRule: normalizeDayRule(d.dayRule),
    // Same for the skip allowance: an older file imports as one shared skip a week, which
    // is what the app did before it was settable.
    skipRule: normalizeSkipRule(d.skipRule),
    habitFreezes: parseHabitFreezes(d.habitFreezes),
    // Missing from files written before the reference was editable.
    tipPrefs: normalizeTipPrefs(d.tipPrefs),
    lateRule: normalizeLateRule(d.lateRule),
    // Отсутствует во всех файлах, записанных до CaloriX.
    balanceProfile: normalizeProfile(d.balanceProfile),
    balanceProducts: list(d.balanceProducts)
      .map(normalizeProduct)
      .filter((p): p is NonNullable<ReturnType<typeof normalizeProduct>> => p !== null),
    balanceFoodLog: list(d.balanceFoodLog)
      .map(normalizeEntry)
      .filter((e): e is NonNullable<ReturnType<typeof normalizeEntry>> => e !== null),
    balanceDishes: list(d.balanceDishes)
      .map(normalizeDish)
      .filter((x): x is NonNullable<ReturnType<typeof normalizeDish>> => x !== null),
    balanceWeight: list(d.balanceWeight)
      .map(normalizeWeightEntry)
      .filter((w): w is NonNullable<ReturnType<typeof normalizeWeightEntry>> => w !== null),
    // Отсутствует в файлах, записанных до счётчика воды.
    balanceWater: list(d.balanceWater)
      .map(normalizeWaterDay)
      .filter((w): w is NonNullable<ReturnType<typeof normalizeWaterDay>> => w !== null),
    // Отсутствуют во всех файлах, записанных до раздела «Экран».
    screenDays: list(d.screenDays)
      .map(normalizeScreenDay)
      .filter((x): x is NonNullable<ReturnType<typeof normalizeScreenDay>> => x !== null),
    screenApps: list(d.screenApps)
      .map(normalizeAppDay)
      .filter((x): x is NonNullable<ReturnType<typeof normalizeAppDay>> => x !== null),
    // Отсутствует в файлах, записанных до почасовой истории.
    screenHours: list(d.screenHours)
      .map(normalizeHourlyDay)
      .filter((x): x is NonNullable<ReturnType<typeof normalizeHourlyDay>> => x !== null),
  };
}

/** Days each habit spent its own chance on. Anything that is not a list of date keys is dropped. */
function parseHabitFreezes(raw: unknown): Record<string, string[]> {
  if (!isObj(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, days] of Object.entries(raw)) {
    const valid = list(days).filter(isDateKey);
    if (valid.length > 0) out[id] = valid;
  }
  return out;
}

function parseReminder(raw: unknown): ReminderSettings | null {
  if (!isObj(raw)) return null;
  // normalizeSettings understands both the current { times: [...] } shape and
  // the single { hour, minute } one older exports carry, and drops anything
  // out of range, so a file from either version imports cleanly.
  return normalizeSettings(raw);
}

function parseScope(raw: unknown): BackupScope {
  return raw === "sterzhen" || raw === "calorix" || raw === "creker" ? raw : "all";
}

export interface ParsedBackup {
  data: BackupData;
  reminder: ReminderSettings | null;
  exportedAt: string | null;
  /** Какой раздел лежит в файле. Файлы, записанные до раздельных копий, — всегда общие. */
  scope: BackupScope;
}

/** Сколько записей в копии относится к разделу — то, что человек считает «данными». */
export function countRecords(data: BackupData, scope: BackupScope): number {
  const sterzhen =
    data.habits.length +
    data.habitLog.length +
    data.sessions.length +
    data.energy.length +
    data.rewards.length +
    data.reviews.length +
    data.tasks.length;
  const calorix =
    data.balanceProducts.length +
    data.balanceDishes.length +
    data.balanceFoodLog.length +
    data.balanceWeight.length +
    data.balanceWater.length +
    (data.balanceProfile ? 1 : 0);
  const creker = data.screenDays.length + data.screenApps.length + data.screenHours.length;
  if (scope === "sterzhen") return sterzhen;
  if (scope === "calorix") return calorix;
  if (scope === "creker") return creker;
  return sterzhen + calorix + creker;
}

/** Turns file text into something safe to write. Throws `BackupError`. */
export function parseBackupText(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("Это не файл резервной копии — не удалось прочитать JSON.");
  }
  if (!isObj(raw)) throw new BackupError("Это не файл резервной копии.");
  if (raw.app !== APP_ID) throw new BackupError("Файл не от этого приложения — ищи no-burnout-….json.");
  if (isNum(raw.formatVersion) && raw.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError("Файл создан более новой версией приложения — обнови приложение и попробуй снова.");
  }

  const data = parseData(raw.data);
  const scope = parseScope(raw.scope);
  // Пусто ли — спрашивается у того раздела, который в файле и лежит. Раньше проверялись
  // только привычки, и копия одного «Экрана» отвергалась как пустая, хотя в ней был год
  // истории.
  if (countRecords(data, scope) === 0) {
    throw new BackupError("В файле нет данных, которые можно перенести.");
  }

  return {
    data,
    scope,
    reminder: parseReminder(raw.reminder),
    exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : null,
  };
}

/**
 * Writes a parsed backup to the device.
 *
 * The reminder time is only taken on a full replace — merging is for pulling
 * history in from another phone, and silently re-arming someone else's 21:00
 * notification would be a surprise.
 *
 * Замена по копии одного раздела заменяет только его: остальное берётся из того, что уже
 * лежит на телефоне. Иначе «заменить еду» стирало бы привычки — файл-то их не содержит, и
 * пустота в нём означает «не про меня», а не «удалить».
 */
export async function applyBackup(parsed: ParsedBackup, mode: ImportMode): Promise<ImportStats> {
  const incoming =
    mode === "replace" && parsed.scope !== "all"
      ? overlay(await exportData(), parsed.data, parsed.scope)
      : parsed.data;
  const stats = mode === "replace" ? await replaceData(incoming) : await mergeData(incoming);
  if (mode === "replace" && parsed.reminder) {
    // Goes through setReminderSettings, not straight to storage, so the OS
    // notification is actually re-scheduled for the restored time.
    await setReminderSettings(parsed.reminder);
  }
  return stats;
}
