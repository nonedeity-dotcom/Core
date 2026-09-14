import { plural } from "./plural";
import type { Habit } from "../types";

/**
 * Насколько привычка тяжёлая — и сколько каждого рода нужно закрыть.
 *
 * Правило дня считает привычки штуками: «пять из пяти». Но пять привычек редко бывают
 * одинаковыми, и день, закрытый пятью лёгкими, и день с двумя тяжёлыми внутри — это разные
 * дни, а счётчик у них один. Уровень это различие возвращает, а норма по уровням даёт его
 * потребовать: «каждый день одна сложная, две средние».
 *
 * Зачёта вверх нет намеренно: три сложные не закрывают норму по лёгким. Норма по лёгким —
 * это чаще всего быт, который иначе проседает именно в те дни, когда взялся за тяжёлое.
 *
 * Модуль чистый: на входе привычки, отметки и норма, на выходе числа. Ни хранилища, ни
 * экранов — поэтому его можно гонять в node.
 */

export type HabitLevel = "hard" | "medium" | "easy";

/** От тяжёлого к лёгкому — в этом порядке уровни и показываются везде. */
export const LEVELS: HabitLevel[] = ["hard", "medium", "easy"];

/** То, чем была каждая привычка до того, как уровни появились. */
export const DEFAULT_LEVEL: HabitLevel = "medium";

export const LEVEL_LABELS: Record<HabitLevel, string> = {
  hard: "Сложный",
  medium: "Средний",
  easy: "Лёгкий",
};

/** «одна сложная», «две средние» — для строк, где уровень стоит при числе. */
export const LEVEL_FORMS: Record<HabitLevel, [string, string, string]> = {
  hard: ["сложная", "сложные", "сложных"],
  medium: ["средняя", "средние", "средних"],
  easy: ["лёгкая", "лёгкие", "лёгких"],
};

export interface LevelQuota {
  hard: number;
  medium: number;
  easy: number;
}

export interface LevelRule {
  /** Сколько каждого уровня нужно закрыть за день. Входит в приговор дня. */
  daily: LevelQuota;
  /**
   * Сколько за неделю. Отдельная цель рядом, а не часть приговора: закрыт ли сегодняшний
   * день, по недельному числу узнать нельзя, а вся серия держится именно на этом.
   */
  weekly: LevelQuota;
}

export const EMPTY_QUOTA: LevelQuota = { hard: 0, medium: 0, easy: 0 };

/** Ноль везде: пока сам не поставишь числа, уровни ничего не требуют и ничего не ломают. */
export const DEFAULT_LEVEL_RULE: LevelRule = { daily: { ...EMPTY_QUOTA }, weekly: { ...EMPTY_QUOTA } };

/** Выше двадцати норма перестаёт быть нормой — столько привычек одного рода не держат. */
export const MAX_QUOTA = 20;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const isLevel = (v: unknown): v is HabitLevel => v === "hard" || v === "medium" || v === "easy";

/** Уровень привычки. Не проставлен — средний: это и есть «обычная привычка». */
export function habitLevel(habit: { level?: unknown }): HabitLevel {
  return isLevel(habit.level) ? habit.level : DEFAULT_LEVEL;
}

export function emptyQuota(): LevelQuota {
  return { ...EMPTY_QUOTA };
}

/** Сколько привычек каждого уровня в этом наборе. */
export function countLevels(habits: Habit[]): LevelQuota {
  const out = emptyQuota();
  for (const h of habits) out[habitLevel(h)] += 1;
  return out;
}

export function quotaTotal(quota: LevelQuota): number {
  return quota.hard + quota.medium + quota.easy;
}

export function quotaIsEmpty(quota: LevelQuota): boolean {
  return quotaTotal(quota) === 0;
}

/**
 * Норма, урезанная до того, что вообще есть.
 *
 * Требовать две сложные, когда сложная всего одна, — это день, который нельзя закрыть
 * никогда, а планка, которую нельзя взять, хуже, чем никакой. Ровно так же ведёт себя и
 * общее правило дня: см. requiredForDay.
 */
export function capQuota(quota: LevelQuota, available: LevelQuota): LevelQuota {
  return {
    hard: Math.min(quota.hard, available.hard),
    medium: Math.min(quota.medium, available.medium),
    easy: Math.min(quota.easy, available.easy),
  };
}

/** Сошлась ли норма. Строго по уровням: сложная за лёгкую не идёт. */
export function meetsQuota(closed: LevelQuota, quota: LevelQuota): boolean {
  return closed.hard >= quota.hard && closed.medium >= quota.medium && closed.easy >= quota.easy;
}

/** Сколько ещё не хватает по каждому уровню. Ноль — этот уровень закрыт. */
export function shortfall(closed: LevelQuota, quota: LevelQuota): LevelQuota {
  return {
    hard: Math.max(0, quota.hard - closed.hard),
    medium: Math.max(0, quota.medium - closed.medium),
    easy: Math.max(0, quota.easy - closed.easy),
  };
}

function normalizeQuota(raw: unknown): LevelQuota {
  if (typeof raw !== "object" || raw === null) return emptyQuota();
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), 0, MAX_QUOTA) : 0);
  return { hard: num(o.hard), medium: num(o.medium), easy: num(o.easy) };
}

export function normalizeLevelRule(raw: unknown): LevelRule {
  if (typeof raw !== "object" || raw === null) return { daily: emptyQuota(), weekly: emptyQuota() };
  const o = raw as Record<string, unknown>;
  return { daily: normalizeQuota(o.daily), weekly: normalizeQuota(o.weekly) };
}

/** «1 сложная, 2 средние» — норма словами. Нули не называются: их там нет. */
export function describeQuota(quota: LevelQuota): string {
  const parts = LEVELS.filter((l) => quota[l] > 0).map((l) => `${quota[l]} ${plural(quota[l], LEVEL_FORMS[l])}`);
  return parts.length > 0 ? parts.join(", ") : "ничего не требуется";
}

/**
 * Что из этого набора закрыто на этот день.
 *
 * `isClosed` приходит снаружи, потому что «закрыта» у привычки со счётчиком значит «набрала
 * свою дневную норму», и правило это живёт в habits.ts. Здесь только раскладка по уровням.
 */
export function closedLevels(habits: Habit[], isClosed: (habit: Habit) => boolean): LevelQuota {
  const out = emptyQuota();
  for (const h of habits) if (isClosed(h)) out[habitLevel(h)] += 1;
  return out;
}

/**
 * За неделю: сколько «привычко-дней» каждого уровня закрыто.
 *
 * Считаются дни, а не нажатия: привычка со счётчиком «3 раза в день», закрытая в понедельник,
 * даёт за неделю единицу, а не тройку. Иначе одна привычка с большим счётчиком закрывала бы
 * недельную норму целиком, а норма ставится про то, сколько раз ты за неделю за это брался.
 *
 * Сюда идут и недельные привычки тоже — те, что дня не решают. «Спорт три раза в неделю» —
 * это ровно то, что осмысленно считать за неделю, и вычёркивать его из недельной нормы
 * значило бы считать неделю по дневным правилам.
 */
export function weeklyLevels(habits: Habit[], closedDaysOf: (habit: Habit) => number): LevelQuota {
  const out = emptyQuota();
  for (const h of habits) out[habitLevel(h)] += Math.max(0, closedDaysOf(h));
  return out;
}

/** «сложная», «средняя», «лёгкая» — метка на строке привычки. */
export const LEVEL_SHORT: Record<HabitLevel, string> = {
  hard: "сложная",
  medium: "средняя",
  easy: "лёгкая",
};
