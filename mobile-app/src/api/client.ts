import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  HabitTarget,
  HabitSchedule,
  ItemGroup,
  Habit,
  HabitLog,
  EnergyLog,
  FocusSession,
  RewardOption,
  Reward,
  Task,
  WeeklyReview,
} from "../types";
import { todayKey, tomorrowKey } from "../lib/date";
import { habitGroup, itemGroup } from "../lib/habits";
import { DEFAULT_DAY_RULE, normalizeDayRule, type DayRule } from "../lib/dayRule";
import { DEFAULT_SKIP_RULE, normalizeSkipRule, type SkipRule } from "../lib/skipRule";
import { DEFAULT_TIP_PREFS, normalizeTipPrefs, type TipPrefs } from "../lib/tipLibrary";
import { DEFAULT_LATE_RULE, normalizeLateRule, normalizeSchedule, type LateRule } from "../lib/habitSchedule";
import { normalizeProfile, type Profile } from "../lib/balance/profile";
import { normalizeDish, normalizeEntry, normalizeProduct, type Dish, type FoodEntry, type FoodProduct } from "../lib/balance/food";

// Local-only storage: no account, no server. Everything lives in
// AsyncStorage on this device — same idea as the original demo's
// window.storage, just with a native persistence backend. The `api` name
// is kept so screens don't need to change their imports.

const KEYS = {
  habits: "habits-list-v1",
  habitLog: "habit-log-v1",
  energy: "energy-log-v1",
  sessions: "timer-stats-v1",
  milestones: "celebrated-milestones-v1",
  rewardOptions: "reward-options-v1",
  rewards: "rewards-log-v1",
  screenTimeLimit: "screen-time-limit-minutes-v1",
  tipCursor: "tip-cursor-v1",
  focusIntervals: "focus-intervals-v1",
  reviews: "weekly-reviews-v1",
  tasks: "tasks-v1",
  calendarPrefs: "calendar-prefs-v1",
  freezes: "streak-freezes-v1",
  nowSinceRepair: "nowsince-repair-v1",
  dayRule: "day-rule-v1",
  skipRule: "skip-rule-v1",
  habitFreezes: "habit-freezes-v1",
  tipPrefs: "tip-prefs-v1",
  lateRule: "late-rule-v1",
  balanceProfile: "balance-profile-v1",
  balanceProducts: "balance-products-v1",
  balanceFoodLog: "balance-food-log-v1",
  balanceDishes: "balance-dishes-v1",
};

export interface CalendarPrefs {
  /**
   * Month grid or four rolling weeks. Whether the calendar is unfolded is deliberately not
   * here: which view you prefer is a setting, being open right now is not — see useFold.
   */
  mode: "month" | "weeks";
}

/** Folded away by default — the calendar is not what you open the app for. */
export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = { mode: "month" };

export interface FocusIntervals {
  /** The wind-down before work — the source's "10-20 минут скуки". */
  boredomMin: number;
  workMin: number;
  breakMin: number;
}

/**
 * 50/10 as the starting point — the ratio the app's source material uses — and 15 minutes
 * of boredom, the middle of the range it gives.
 */
export const DEFAULT_FOCUS_INTERVALS: FocusIntervals = { boredomMin: 15, workMin: 50, breakMin: 10 };

export const DEFAULT_SCREEN_TIME_LIMIT_MIN = 180; // 3h/day, matches no particular study — just a sane starting point

export const STREAK_MILESTONES = [7, 14, 30, 66];

async function read<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupted/half-written value used to throw out of every query and
    // blank the screen with no way back. Falling back to the default keeps
    // the app usable; the bad value is overwritten on the next write.
    return fallback;
  }
}

async function write<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// Every mutation here is a read-modify-write, and several can be in flight at
// once (the screen-time sync ticking a habit while the user taps another one,
// two quick taps in a row). Without serialising, both read the same array and
// the second write silently discards the first one's change. Queueing per key
// keeps them ordered without blocking unrelated keys.
const writeQueues = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  // Keep the chain alive but don't let a rejection poison later callers.
  writeQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 1 minute to 4 hours — anything outside that is a broken value, not a choice. */
function clampMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(240, Math.max(1, Math.round(value)));
}

function inRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

// Seeded once on first launch so the app isn't empty — there's no "add
// habit/trigger" UI yet, so these are the starting set (drawn from the
// focus/dopamine-detox notes the app is built around).
const DEFAULT_HABITS: Habit[] = [
  { id: uid(), label: "10–20 минут скуки перед стартом работы", hint: "тишина, без экрана, без музыки", minimal: "5 минут тишины", sortOrder: 0 },
  { id: uid(), label: "Ритуал входа в фокус", hint: "крепкий чай/кофе — сигнал мозгу", sortOrder: 1 },
  { id: uid(), label: "Телефон — в другой комнате на время работы", sortOrder: 2 },
  { id: uid(), label: "Чёткий дедлайн перед стартом задачи", sortOrder: 3 },
  { id: uid(), label: "10 минут без телефона после блока работы", hint: "50 минут работа / 10 минут отдых", minimal: "3 минуты без телефона", sortOrder: 4 },
  { id: uid(), label: "Час без телефона с утра", minimal: "15 минут без телефона", sortOrder: 5 },
  { id: uid(), label: "Стакан воды сразу после пробуждения", sortOrder: 6 },
  { id: uid(), label: "Чай без сахара — без резких стимулов с утра", sortOrder: 7 },
  { id: uid(), label: "Без еды в первый час после пробуждения", sortOrder: 8 },
  {
    id: uid(),
    label: "Экранное время в норме",
    hint: "авто из Creker, если установлен — иначе отмечай сам",
    sortOrder: 9,
    auto: "screentime",
  },
];

const DEFAULT_REWARD_OPTIONS: RewardOption[] = [
  { id: uid(), label: "Прогулка" },
  { id: uid(), label: "Чай" },
  { id: uid(), label: "Медитация" },
  { id: uid(), label: "Спорт" },
  { id: uid(), label: "Холодный душ" },
];


async function ensureSeeded() {
  if ((await AsyncStorage.getItem(KEYS.habits)) === null) await write(KEYS.habits, DEFAULT_HABITS);
  if ((await AsyncStorage.getItem(KEYS.rewardOptions)) === null) await write(KEYS.rewardOptions, DEFAULT_REWARD_OPTIONS);
  await migrateHabitCreatedAt();
  // After it, not before: this one reads createdAt.
  await repairNowSinceOnce();
  await dropTriggers();
}

/**
 * Deletes the trigger list from the device.
 *
 * The triggers screen is gone, and leaving its data behind would mean a key nothing reads
 * and nothing can ever show again — a row in storage that only exists to be restored by a
 * feature that no longer exists. Removed rather than orphaned, deliberately and on request.
 * Also drops out of backups: see BackupData.
 */
async function dropTriggers(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRIGGERS_KEY);
  } catch {
    // Nothing depends on it being gone; the next launch tries again.
  }
}

/** Not in KEYS any more — the only thing left that knows this name is the delete above. */
const TRIGGERS_KEY = "triggers-list-v1";

/**
 * Stamps a start date on habits saved before there was one.
 *
 * The date is the habit's first mark, because that is the only evidence on the device of
 * when it actually started being a habit. One that was never ticked gets today: it has no
 * history to judge, and dating it to the beginning of time is exactly the bug this fixes —
 * a habit added yesterday would still be re-judging last month.
 *
 * Runs once. Afterwards every habit has the field and this is a no-op.
 */
async function migrateHabitCreatedAt(): Promise<void> {
  const habits = await read<Habit[]>(KEYS.habits, []);
  if (habits.length === 0 || habits.every((h) => !!h.createdAt)) return;

  const logs = await read<HabitLog[]>(KEYS.habitLog, []);
  const firstMark = new Map<string, string>();
  for (const l of logs) {
    if (!l.done) continue;
    const seen = firstMark.get(l.habitId);
    if (seen === undefined || l.date < seen) firstMark.set(l.habitId, l.date);
  }

  const today = todayKey();
  await write(
    KEYS.habits,
    habits.map((h) => (h.createdAt ? h : { ...h, createdAt: firstMark.get(h.id) ?? today })),
  );
}

/**
 * Forgives, once, the chains this bug had already broken.
 *
 * `nowSince` fixes the rule going forward, but it cannot undo what happened before it
 * existed: a habit created a couple of days ago, parked in «потом» or «дополнительно» and
 * then moved into «ввожу сейчас» is stored with nothing but its old `createdAt`, so it goes
 * on answering for the days it spent outside the checklist and the streak stays at zero
 * however long you keep it.
 *
 * There is no record of when a habit joined the pile, so this cannot be exact. What it does
 * is narrow: a habit that is in «ввожу сейчас», was created before today, and has never once
 * been ticked, is forgiven its past and owed from tomorrow. Never having been marked is the
 * signature of a habit that was somewhere else until now — and for one that really was on
 * the list and simply never done, forgiving it raises the number by giving back days that
 * were otherwise kept, which is the safe direction for a guess.
 *
 * Runs exactly once, behind its own key. As an ongoing rule it would be wrong: it would keep
 * forgiving every habit you add and do not tick.
 */
async function repairNowSinceOnce(): Promise<void> {
  if ((await AsyncStorage.getItem(KEYS.nowSinceRepair)) !== null) return;

  const habits = await read<Habit[]>(KEYS.habits, []);
  const logs = await read<HabitLog[]>(KEYS.habitLog, []);
  const everMarked = new Set(logs.filter((l) => l.done).map((l) => l.habitId));
  const today = todayKey();
  const tomorrow = tomorrowKey();

  await write(
    KEYS.habits,
    habits.map((h) =>
      // `createdAt < today` keeps a fresh install out of it: the seeded habits are stamped
      // with today by the migration above, and forgiving those would mean day one could
      // never count.
      !h.archivedAt &&
      itemGroup(h) === "now" &&
      h.nowSince === undefined &&
      h.createdAt !== undefined &&
      h.createdAt < today &&
      !everMarked.has(h.id)
        ? { ...h, nowSince: tomorrow }
        : h,
    ),
  );
  await AsyncStorage.setItem(KEYS.nowSinceRepair, "done");
}

export const api = {
  /**
   * The checklist: everything not put aside.
   *
   * Archived habits are filtered out here rather than at each call site, because every
   * screen that asks for "the habits" means the live ones — the streak's deciding set, the
   * day's rows, the report's list. The two places that want the retired ones ask for them
   * by name (getArchivedHabits, getAllHabits).
   */
  async getHabits(): Promise<Habit[]> {
    await ensureSeeded();
    const habits = await read<Habit[]>(KEYS.habits, []);
    // sortOrder was stored but never actually applied, so the list only looked
    // right because the seed happened to be inserted in order.
    return [...habits].filter((h) => !h.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  },
  /** The archive, most recently put aside first. */
  async getArchivedHabits(): Promise<Habit[]> {
    await ensureSeeded();
    const habits = await read<Habit[]>(KEYS.habits, []);
    return habits
      .filter((h) => !!h.archivedAt)
      .sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
  },
  /**
   * Both lists together. Only for looking one habit up by id — a habit's own report has to
   * open from the archive as well as from the checklist, and that screen has no way of
   * knowing which list the id came from.
   */
  async getAllHabits(): Promise<Habit[]> {
    await ensureSeeded();
    const habits = await read<Habit[]>(KEYS.habits, []);
    return [...habits].sort((a, b) => a.sortOrder - b.sortOrder);
  },
  async addHabit(label: string, hint?: string): Promise<Habit> {
    return withKeyLock(KEYS.habits, async () => {
      await ensureSeeded();
      const habits = await read<Habit[]>(KEYS.habits, []);
      // Max+1, not length: after any deletion, length collides with an
      // existing sortOrder and two habits fight for the same slot.
      const nextOrder = habits.reduce((max, h) => Math.max(max, h.sortOrder), -1) + 1;
      const habit: Habit = {
        id: uid(),
        label,
        hint: hint ?? null,
        minimal: null,
        sortOrder: nextOrder,
        // Tomorrow, not today. Without any date the streak judged every past day against a
        // habit that had just been invented and wiped the whole chain; with today's date it
        // still un-completed today, so adding a habit in the morning dropped the number by
        // one until you ticked it. A habit is something you start keeping from the next
        // day — ticking it earlier still counts, it just isn't owed yet.
        createdAt: tomorrowKey(),
      };
      await write(KEYS.habits, [...habits, habit]);
      return habit;
    });
  },
  /**
   * Editing a habit — including moving it between the three piles.
   *
   * Moving one *into* «ввожу сейчас» from somewhere else re-stamps when it starts being
   * owed. Without that it answers for every day since it was created, including the weeks
   * it spent in «дополнительно» collecting no marks because it was not on the list — which
   * takes the chain to zero on the first of them. Same rule as adding a new one: owed from
   * tomorrow, tickable today.
   */
  async updateHabit(
    id: string,
    data: {
      label?: string;
      hint?: string;
      minimal?: string | null;
      group?: ItemGroup;
      target?: HabitTarget;
      /** null clears the schedule; undefined leaves it as it was. */
      schedule?: HabitSchedule | null;
    },
  ): Promise<{ ok: true }> {
    return withKeyLock(KEYS.habits, async () => {
      const habits = await read<Habit[]>(KEYS.habits, []);
      await write(
        KEYS.habits,
        habits.map((h) => {
          if (h.id !== id) return h;
          const joiningNow = data.group === "now" && habitGroup(h) !== "now";
          const { schedule, ...rest } = data;
          const next: Habit = { ...h, ...rest };
          if (schedule === null) delete next.schedule;
          else if (schedule !== undefined) {
            const clean = normalizeSchedule(schedule);
            if (clean) next.schedule = clean;
            else delete next.schedule;
          }
          return joiningNow ? { ...next, nowSince: tomorrowKey() } : next;
        }),
      );
      return { ok: true as const };
    });
  },
  /**
   * Puts a habit aside without losing anything.
   *
   * The marks stay exactly where they are, so restoring brings the whole history back and
   * the habit's own report keeps working while it sits in the archive. It stops deciding
   * the day the moment it leaves the checklist — that falls out of getHabits filtering it,
   * not from anything the streak has to know about.
   */
  async archiveHabit(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.habits, async () => {
      const habits = await read<Habit[]>(KEYS.habits, []);
      const at = new Date().toISOString();
      await write(
        KEYS.habits,
        habits.map((h) => (h.id === id ? { ...h, archivedAt: at } : h)),
      );
      return { ok: true as const };
    });
  },
  /**
   * Back into the checklist, into whichever pile it was in when it was put aside.
   *
   * It is owed again from tomorrow, not from whenever it was first created: the days it
   * spent in the archive have no marks precisely because it was not on the list, and
   * judging them would break the chain the moment you brought an old habit back.
   */
  async restoreHabit(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.habits, async () => {
      const habits = await read<Habit[]>(KEYS.habits, []);
      await write(
        KEYS.habits,
        habits.map((h) => (h.id === id ? { ...h, archivedAt: null, nowSince: tomorrowKey() } : h)),
      );
      return { ok: true as const };
    });
  },
  /** The irreversible one, reachable only from the archive. */
  async removeHabit(id: string): Promise<{ ok: true }> {
    await withKeyLock(KEYS.habits, async () => {
      const habits = await read<Habit[]>(KEYS.habits, []);
      await write(
        KEYS.habits,
        habits.filter((h) => h.id !== id),
      );
    });
    // The habit's log entries used to be left behind forever, and everything
    // that counts logs (today's "выполнено N", the streak, the day bars) kept
    // counting them — deleting a ticked habit left the count one too high.
    await withKeyLock(KEYS.habitLog, async () => {
      const logs = await read<HabitLog[]>(KEYS.habitLog, []);
      await write(
        KEYS.habitLog,
        logs.filter((l) => l.habitId !== id),
      );
    });
    return { ok: true };
  },
  async getHabitLog(from: string, to: string): Promise<HabitLog[]> {
    const logs = await read<HabitLog[]>(KEYS.habitLog, []);
    return logs.filter((l) => inRange(l.date, from, to));
  },
  /**
   * `minimal` marks the day as closed with the cut-down version. It still
   * counts as done — a small day is the thing that keeps the chain alive —
   * but it is recorded separately so the report can tell them apart.
   */
  /**
   * `manual` marks the change as a person's tap rather than a fill-in from creker. Once a
   * day is set by hand it stays that way: see syncScreenTimeHabit, which reads the flag
   * back and leaves such a day alone.
   */
  /**
   * Writes a day's progress for one habit. Everything else here goes through it.
   *
   * `count` is clamped to 0..target, which is what makes a tap unable to undo anything: the
   * counter walks up and stops. `done` is derived rather than passed in, so the flag the
   * calendar and the streak read can never disagree with the number the row shows.
   */
  async setHabitProgress(
    habitId: string,
    date: string,
    count: number,
    target: number,
    opts: { minimal?: boolean; manual?: boolean } = {},
  ): Promise<HabitLog> {
    return withKeyLock(KEYS.habitLog, async () => {
      const logs = await read<HabitLog[]>(KEYS.habitLog, []);
      const existing = logs.find((l) => l.habitId === habitId && l.date === date);
      const capped = Math.min(Math.max(1, target), Math.max(0, Math.trunc(count)));
      const done = capped >= Math.max(1, target);
      // Never cleared by an automatic write: a sync passing manual=false must not erase the
      // flag a tap set earlier in the day.
      const manual = opts.manual || existing?.manual === true;
      const minimal = done ? (opts.minimal ?? existing?.minimal ?? false) : false;
      const entry: HabitLog = existing
        ? { ...existing, count: capped, done, minimal, manual }
        : { id: uid(), habitId, date, count: capped, done, minimal, manual };
      await write(KEYS.habitLog, existing ? logs.map((l) => (l === existing ? entry : l)) : [...logs, entry]);
      return entry;
    });
  },

  /**
   * One tap: one step up, stopping at the target. Reading and writing under the same lock so
   * two quick taps count as two rather than both reading the same number and writing 1.
   */
  async bumpHabit(habitId: string, date: string, target: number, minimal = false): Promise<HabitLog> {
    return withKeyLock(KEYS.habitLog, async () => {
      const logs = await read<HabitLog[]>(KEYS.habitLog, []);
      const existing = logs.find((l) => l.habitId === habitId && l.date === date);
      const current =
        typeof existing?.count === "number" ? Math.max(0, Math.trunc(existing.count)) : existing?.done ? 1 : 0;
      const cap = Math.max(1, target);
      const capped = Math.min(cap, current + 1);
      const done = capped >= cap;
      const entry: HabitLog = existing
        ? { ...existing, count: capped, done, minimal: done ? minimal || !!existing.minimal : false, manual: true }
        : { id: uid(), habitId, date, count: capped, done, minimal: done ? minimal : false, manual: true };
      await write(KEYS.habitLog, existing ? logs.map((l) => (l === existing ? entry : l)) : [...logs, entry]);
      return entry;
    });
  },

  /** Back to zero for the day — the only way to undo a tap, and it lives in edit mode. */
  async resetHabitDay(habitId: string, date: string): Promise<{ ok: true }> {
    await withKeyLock(KEYS.habitLog, async () => {
      const logs = await read<HabitLog[]>(KEYS.habitLog, []);
      const existing = logs.find((l) => l.habitId === habitId && l.date === date);
      if (!existing) return;
      const entry: HabitLog = { ...existing, count: 0, done: false, minimal: false, manual: true };
      await write(KEYS.habitLog, logs.map((l) => (l === existing ? entry : l)));
    });
    return { ok: true as const };
  },

  /**
   * Days that were skipped but did not break the chain — see freezeCandidate. Stored as a
   * plain list of dates, granted once and never recomputed: a freeze that could be
   * re-derived on every render would change the streak under someone who had already read
   * it.
   */
  /**
   * How much of the «ввожу сейчас» pile closes a day.
   *
   * Read by everything that judges a day — the streak, the calendar, the statistics screen
   * and today's own header — so it lives here rather than in the screen that edits it.
   * Anything unreadable comes back as the default rather than throwing: a corrupt entry
   * should cost the setting, not the app.
   */
  async getDayRule(): Promise<DayRule> {
    return normalizeDayRule(await read<unknown>(KEYS.dayRule, DEFAULT_DAY_RULE));
  },
  async setDayRule(rule: DayRule): Promise<{ ok: true }> {
    await write(KEYS.dayRule, normalizeDayRule(rule));
    return { ok: true as const };
  },

  /**
   * How many skipped days a chain forgives, over what period, and whether the budget belongs
   * to the day or to each habit. Read by the streak, the freeze grant and both reports.
   */
  async getSkipRule(): Promise<SkipRule> {
    return normalizeSkipRule(await read<unknown>(KEYS.skipRule, DEFAULT_SKIP_RULE));
  },
  async setSkipRule(rule: SkipRule): Promise<{ ok: true }> {
    await write(KEYS.skipRule, normalizeSkipRule(rule));
    return { ok: true as const };
  },

  /**
   * Days each habit spent one of its own chances on, by habit id.
   *
   * Granted once and never recomputed, the same as the shared freezes and for the same
   * reason: a forgiveness derived on every render would let a number move under someone who
   * had already read it.
   */
  async getHabitFreezes(): Promise<Record<string, string[]>> {
    const stored = await read<Record<string, string[]>>(KEYS.habitFreezes, {});
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
    const out: Record<string, string[]> = {};
    for (const [id, days] of Object.entries(stored)) {
      if (Array.isArray(days)) out[id] = days.filter((d) => typeof d === "string");
    }
    return out;
  },
  /** Idempotent — granting the same day to the same habit twice is a no-op. */
  async grantHabitFreeze(habitId: string, date: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.habitFreezes, async () => {
      const current = await read<Record<string, string[]>>(KEYS.habitFreezes, {});
      const days = Array.isArray(current[habitId]) ? current[habitId] : [];
      if (days.includes(date)) return { ok: true as const };
      await write(KEYS.habitFreezes, { ...current, [habitId]: [...days, date].sort() });
      return { ok: true as const };
    });
  },

  /**
   * Your edits to the reference: rewritten lines, hidden tips, your own, and the order the
   * rotation runs in. The built-in tips themselves stay in the bundle — this is only the
   * difference between them and what you want to read.
   */
  async getTipPrefs(): Promise<TipPrefs> {
    return normalizeTipPrefs(await read<unknown>(KEYS.tipPrefs, DEFAULT_TIP_PREFS));
  },
  async setTipPrefs(prefs: TipPrefs): Promise<{ ok: true }> {
    return withKeyLock(KEYS.tipPrefs, async () => {
      await write(KEYS.tipPrefs, normalizeTipPrefs(prefs));
      return { ok: true as const };
    });
  },

  /** What a missed window costs — see LateRule. A rule about all habits, not about one. */
  async getLateRule(): Promise<LateRule> {
    return normalizeLateRule(await read<unknown>(KEYS.lateRule, DEFAULT_LATE_RULE));
  },
  async setLateRule(rule: LateRule): Promise<{ ok: true }> {
    await write(KEYS.lateRule, normalizeLateRule(rule));
    return { ok: true as const };
  },

  /**
   * «Баланс»: рост, вес, возраст и цель, из которых считаются нормы.
   *
   * null, пока не заполнен — считать не по чему, и половина норм хуже, чем честная просьба
   * дозаполнить.
   */
  async getBalanceProfile(): Promise<Profile | null> {
    return normalizeProfile(await read<unknown>(KEYS.balanceProfile, null));
  },
  async setBalanceProfile(profile: Profile): Promise<{ ok: true }> {
    await write(KEYS.balanceProfile, profile);
    return { ok: true as const };
  },

  /** Свои продукты — всё, что есть у «Баланса»: встроенной базы нет. */
  async getFoodProducts(): Promise<FoodProduct[]> {
    const raw = await read<unknown[]>(KEYS.balanceProducts, []);
    return (Array.isArray(raw) ? raw : []).map(normalizeProduct).filter((p): p is FoodProduct => p !== null);
  },
  async saveFoodProduct(product: Omit<FoodProduct, "id"> & { id?: string }): Promise<FoodProduct> {
    return withKeyLock(KEYS.balanceProducts, async () => {
      const products = await read<FoodProduct[]>(KEYS.balanceProducts, []);
      const clean = normalizeProduct({ ...product, id: product.id ?? uid() });
      if (!clean) throw new Error("Пустое название");
      const exists = products.some((p) => p.id === clean.id);
      await write(
        KEYS.balanceProducts,
        exists ? products.map((p) => (p.id === clean.id ? { ...p, ...clean } : p)) : [...products, clean],
      );
      return clean;
    });
  },
  async removeFoodProduct(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.balanceProducts, async () => {
      const products = await read<FoodProduct[]>(KEYS.balanceProducts, []);
      await write(KEYS.balanceProducts, products.filter((p) => p.id !== id));
      // Записи в дневнике не трогаем: они хранят свои числа, и съеденное на прошлой
      // неделе не должно исчезать оттого, что продукт больше не нужен в списке.
      return { ok: true as const };
    });
  },

  /** Блюда — сохранённые наборы продуктов. Хранят ссылки, а не числа: это рецепт. */
  async getDishes(): Promise<Dish[]> {
    const raw = await read<unknown[]>(KEYS.balanceDishes, []);
    return (Array.isArray(raw) ? raw : []).map(normalizeDish).filter((d): d is Dish => d !== null);
  },
  async saveDish(dish: Omit<Dish, "id"> & { id?: string }): Promise<Dish> {
    return withKeyLock(KEYS.balanceDishes, async () => {
      const dishes = await read<Dish[]>(KEYS.balanceDishes, []);
      const clean = normalizeDish({ ...dish, id: dish.id ?? uid() });
      if (!clean) throw new Error("Пустое название");
      const exists = dishes.some((d) => d.id === clean.id);
      await write(
        KEYS.balanceDishes,
        exists ? dishes.map((d) => (d.id === clean.id ? { ...d, ...clean } : d)) : [...dishes, clean],
      );
      return clean;
    });
  },
  async removeDish(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.balanceDishes, async () => {
      const dishes = await read<Dish[]>(KEYS.balanceDishes, []);
      await write(KEYS.balanceDishes, dishes.filter((d) => d.id !== id));
      return { ok: true as const };
    });
  },

  async getFoodLog(from: string, to: string): Promise<FoodEntry[]> {
    const raw = await read<unknown[]>(KEYS.balanceFoodLog, []);
    return (Array.isArray(raw) ? raw : [])
      .map(normalizeEntry)
      .filter((e): e is FoodEntry => e !== null && inRange(e.date, from, to));
  },
  /**
   * Кладёт съеденное в дневник и отмечает продукт как только что использованный — из этой
   * отметки и строится «Часто ем».
   */
  async addFoodEntry(entry: Omit<FoodEntry, "id">): Promise<FoodEntry> {
    const saved = await withKeyLock(KEYS.balanceFoodLog, async () => {
      const logs = await read<FoodEntry[]>(KEYS.balanceFoodLog, []);
      const clean = normalizeEntry({ ...entry, id: uid() });
      if (!clean) throw new Error("Некорректная запись");
      await write(KEYS.balanceFoodLog, [...logs, clean]);
      return clean;
    });
    const at = new Date().toISOString();
    if (saved.dishId) {
      await withKeyLock(KEYS.balanceDishes, async () => {
        const dishes = await read<Dish[]>(KEYS.balanceDishes, []);
        await write(KEYS.balanceDishes, dishes.map((d) => (d.id === saved.dishId ? { ...d, lastUsedAt: at } : d)));
      });
    } else if (saved.productId) {
      await withKeyLock(KEYS.balanceProducts, async () => {
        const products = await read<FoodProduct[]>(KEYS.balanceProducts, []);
        await write(KEYS.balanceProducts, products.map((p) => (p.id === saved.productId ? { ...p, lastUsedAt: at } : p)));
      });
    }
    return saved;
  },
  async removeFoodEntry(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.balanceFoodLog, async () => {
      const logs = await read<FoodEntry[]>(KEYS.balanceFoodLog, []);
      await write(KEYS.balanceFoodLog, logs.filter((e) => e.id !== id));
      return { ok: true as const };
    });
  },

  async getFreezes(): Promise<string[]> {
    const stored = await read<string[]>(KEYS.freezes, []);
    return stored.filter((d) => typeof d === "string");
  },

  /** Records a freeze for `date`. Idempotent — granting the same day twice is a no-op. */
  async grantFreeze(date: string): Promise<string[]> {
    return withKeyLock(KEYS.freezes, async () => {
      const current = await read<string[]>(KEYS.freezes, []);
      if (current.includes(date)) return current;
      const next = [...current, date].sort();
      await write(KEYS.freezes, next);
      return next;
    });
  },

  async getEnergy(from: string, to: string): Promise<EnergyLog[]> {
    const logs = await read<EnergyLog[]>(KEYS.energy, []);
    return logs.filter((l) => inRange(l.date, from, to));
  },
  async setEnergy(date: string, hour: number, value: number): Promise<EnergyLog> {
    return withKeyLock(KEYS.energy, async () => {
      const logs = await read<EnergyLog[]>(KEYS.energy, []);
      const existing = logs.find((l) => l.date === date && l.hour === hour);
      const entry: EnergyLog = { date, hour, value };
      await write(KEYS.energy, existing ? logs.map((l) => (l === existing ? entry : l)) : [...logs, entry]);
      return entry;
    });
  },

  async getSessions(from: string, to: string): Promise<FocusSession[]> {
    const sessions = await read<FocusSession[]>(KEYS.sessions, []);
    return sessions.filter((s) => inRange(s.date, from, to));
  },
  async addSession(date: string, durationMin: number): Promise<FocusSession> {
    return withKeyLock(KEYS.sessions, async () => {
      const sessions = await read<FocusSession[]>(KEYS.sessions, []);
      const session: FocusSession = { id: uid(), date, durationMin, completedAt: new Date().toISOString() };
      await write(KEYS.sessions, [...sessions, session]);
      return session;
    });
  },


  async getTasks(): Promise<Task[]> {
    return read(KEYS.tasks, []);
  },
  async addTask(label: string, kind: Task["kind"]): Promise<Task> {
    return withKeyLock(KEYS.tasks, async () => {
      const tasks = await read<Task[]>(KEYS.tasks, []);
      const task: Task = { id: uid(), label, kind, done: false };
      await write(KEYS.tasks, [...tasks, task]);
      return task;
    });
  },
  async setTaskDone(id: string, done: boolean): Promise<{ ok: true }> {
    return withKeyLock(KEYS.tasks, async () => {
      const tasks = await read<Task[]>(KEYS.tasks, []);
      await write(
        KEYS.tasks,
        tasks.map((t) => (t.id === id ? { ...t, done } : t)),
      );
      return { ok: true as const };
    });
  },
  async removeTask(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.tasks, async () => {
      const tasks = await read<Task[]>(KEYS.tasks, []);
      await write(
        KEYS.tasks,
        tasks.filter((t) => t.id !== id),
      );
      return { ok: true as const };
    });
  },
  async clearDoneTasks(): Promise<{ ok: true }> {
    return withKeyLock(KEYS.tasks, async () => {
      const tasks = await read<Task[]>(KEYS.tasks, []);
      await write(
        KEYS.tasks,
        tasks.filter((t) => !t.done),
      );
      return { ok: true as const };
    });
  },

  async getReviews(): Promise<WeeklyReview[]> {
    const reviews = await read<WeeklyReview[]>(KEYS.reviews, []);
    // Newest first: the history list reads top-down and the current week is
    // the one you care about.
    return [...reviews].sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
  },
  /** One review per ISO week — writing again replaces that week's entry. */
  async saveReview(review: WeeklyReview): Promise<WeeklyReview> {
    return withKeyLock(KEYS.reviews, async () => {
      const reviews = await read<WeeklyReview[]>(KEYS.reviews, []);
      const existing = reviews.find((r) => r.week === review.week);
      await write(
        KEYS.reviews,
        existing ? reviews.map((r) => (r === existing ? review : r)) : [...reviews, review],
      );
      return review;
    });
  },

  async getCelebratedMilestones(): Promise<number[]> {
    return read(KEYS.milestones, []);
  },
  async celebrateMilestone(milestone: number): Promise<void> {
    await withKeyLock(KEYS.milestones, async () => {
      const done = await read<number[]>(KEYS.milestones, []);
      if (!done.includes(milestone)) await write(KEYS.milestones, [...done, milestone]);
    });
  },

  async getRewardOptions(): Promise<RewardOption[]> {
    await ensureSeeded();
    return read(KEYS.rewardOptions, []);
  },
  async addRewardOption(label: string): Promise<RewardOption> {
    return withKeyLock(KEYS.rewardOptions, async () => {
      await ensureSeeded();
      const options = await read<RewardOption[]>(KEYS.rewardOptions, []);
      const option: RewardOption = { id: uid(), label };
      await write(KEYS.rewardOptions, [...options, option]);
      return option;
    });
  },
  async updateRewardOption(id: string, label: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.rewardOptions, async () => {
      const options = await read<RewardOption[]>(KEYS.rewardOptions, []);
      await write(
        KEYS.rewardOptions,
        options.map((o) => (o.id === id ? { ...o, label } : o)),
      );
      return { ok: true as const };
    });
  },
  async removeRewardOption(id: string): Promise<{ ok: true }> {
    return withKeyLock(KEYS.rewardOptions, async () => {
      const options = await read<RewardOption[]>(KEYS.rewardOptions, []);
      await write(
        KEYS.rewardOptions,
        options.filter((o) => o.id !== id),
      );
      return { ok: true as const };
    });
  },

  async getRewards(from: string, to: string): Promise<Reward[]> {
    const rewards = await read<Reward[]>(KEYS.rewards, []);
    return rewards.filter((r) => inRange(r.date, from, to));
  },
  async addReward(date: string, text: string): Promise<Reward> {
    return withKeyLock(KEYS.rewards, async () => {
      const rewards = await read<Reward[]>(KEYS.rewards, []);
      const reward: Reward = { id: uid(), date, text };
      await write(KEYS.rewards, [...rewards, reward]);
      return reward;
    });
  },

  async getCalendarPrefs(): Promise<CalendarPrefs> {
    const stored = await read<Partial<CalendarPrefs>>(KEYS.calendarPrefs, {});
    return {
      mode: stored.mode === "weeks" ? "weeks" : "month",
    };
  },
  async setCalendarPrefs(prefs: CalendarPrefs): Promise<CalendarPrefs> {
    await write(KEYS.calendarPrefs, prefs);
    return prefs;
  },
  /**
   * The oldest day with a tick, so the calendar knows how far back it can be
   * paged. Null when nothing has been ticked at all.
   */
  async getEarliestLogDate(): Promise<string | null> {
    const logs = await read<HabitLog[]>(KEYS.habitLog, []);
    let earliest: string | null = null;
    for (const l of logs) {
      if (!l.done) continue;
      if (earliest === null || l.date < earliest) earliest = l.date;
    }
    return earliest;
  },

  async getFocusIntervals(): Promise<FocusIntervals> {
    const stored = await read<Partial<FocusIntervals>>(KEYS.focusIntervals, {});
    // Clamped on read as well as on write: a hand-edited or half-written
    // backup shouldn't be able to produce a timer that never ends.
    return {
      // Absent in anything saved before the boredom phase existed, so it falls back to the
      // default rather than to zero.
      boredomMin: clampMinutes(stored.boredomMin, DEFAULT_FOCUS_INTERVALS.boredomMin),
      workMin: clampMinutes(stored.workMin, DEFAULT_FOCUS_INTERVALS.workMin),
      breakMin: clampMinutes(stored.breakMin, DEFAULT_FOCUS_INTERVALS.breakMin),
    };
  },
  async setFocusIntervals(intervals: FocusIntervals): Promise<FocusIntervals> {
    const safe: FocusIntervals = {
      boredomMin: clampMinutes(intervals.boredomMin, DEFAULT_FOCUS_INTERVALS.boredomMin),
      workMin: clampMinutes(intervals.workMin, DEFAULT_FOCUS_INTERVALS.workMin),
      breakMin: clampMinutes(intervals.breakMin, DEFAULT_FOCUS_INTERVALS.breakMin),
    };
    await write(KEYS.focusIntervals, safe);
    return safe;
  },

  /**
   * Where the tip rotation currently stands, as a 0-based index.
   *
   * Deliberately left out of the backup: this is a bookmark for one device,
   * not history worth carrying to a new phone — restoring someone else's
   * position in the loop would mean nothing.
   */
  async getTipCursor(): Promise<number> {
    return read(KEYS.tipCursor, 0);
  },
  /** Steps to the next tip and returns its index, wrapping at the end. */
  async advanceTipCursor(poolSize: number): Promise<number> {
    if (poolSize <= 0) return 0;
    return withKeyLock(KEYS.tipCursor, async () => {
      // -1 as the default, so the very first launch lands on tip 1 rather
      // than skipping straight to the second one.
      const current = await read<number>(KEYS.tipCursor, -1);
      const next = (((current + 1) % poolSize) + poolSize) % poolSize;
      await write(KEYS.tipCursor, next);
      return next;
    });
  },

  async getScreenTimeLimitMinutes(): Promise<number> {
    return read(KEYS.screenTimeLimit, DEFAULT_SCREEN_TIME_LIMIT_MIN);
  },
  async setScreenTimeLimitMinutes(minutes: number): Promise<void> {
    await write(KEYS.screenTimeLimit, minutes);
  },
};

// ---------------------------------------------------------------------------
// Backup: export everything to one JSON blob and load it back.
//
// There is no account and no server, so a reinstall or a new phone used to
// mean losing every tick, session and note. These two functions are the only
// way that data leaves or enters the device.
// ---------------------------------------------------------------------------

/** Bump when the shape below changes incompatibly. */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupData {
  habits: Habit[];
  habitLog: HabitLog[];
  energy: EnergyLog[];
  sessions: FocusSession[];
  milestones: number[];
  /** Days skipped under the weekly freeze — without these a restore silently shortens the streak. */
  freezes: string[];
  rewardOptions: RewardOption[];
  rewards: Reward[];
  reviews: WeeklyReview[];
  tasks: Task[];
  screenTimeLimitMinutes: number;
  focusIntervals: FocusIntervals;
  /**
   * How much of the «ввожу сейчас» pile closes a day. Absent from files written before it
   * was settable, which import as the default — all of them.
   */
  dayRule: DayRule;
  /** The skip allowance. Absent from older files, which import as one shared skip a week. */
  skipRule: SkipRule;
  /** Days each habit spent its own chance on, by habit id. Absent from older files. */
  habitFreezes: Record<string, string[]>;
  /** Edits to the reference. Absent from older files, which import as the untouched one. */
  tipPrefs: TipPrefs;
  /** What a missed window costs. Absent from older files, which import as "ничего". */
  lateRule: LateRule;
  /** «Баланс»: the profile the day's targets are worked out from. null until it is filled in. */
  balanceProfile: Profile | null;
  balanceProducts: FoodProduct[];
  balanceFoodLog: FoodEntry[];
  balanceDishes: Dish[];
}

/** What an import actually changed, so the UI can report it honestly. */
export interface ImportStats {
  habits: number;
  habitLog: number;
  sessions: number;
  energy: number;
  rewards: number;
  reviews: number;
  tasks: number;
}

const EMPTY_STATS: ImportStats = {
  habits: 0,
  habitLog: 0,
  sessions: 0,
  energy: 0,
  rewards: 0,
  reviews: 0,
  tasks: 0,
};

// Every mutation goes through withKeyLock, so an import has to hold *all* the
// locks at once — otherwise a screen-time sync ticking a habit mid-import
// writes into the list the import is about to replace.
function withAllKeyLocks<T>(job: () => Promise<T>): Promise<T> {
  const keys = Object.values(KEYS);
  return keys.reduceRight<() => Promise<T>>(
    (inner, key) => () => withKeyLock(key, inner),
    job,
  )();
}

/** Reads the whole local database. Nothing is filtered — this is the backup. */
export async function exportData(): Promise<BackupData> {
  await ensureSeeded();
  const [habits, habitLog, energy, sessions, milestones, freezes, rewardOptions, rewards, reviews, tasks, limit, focusIntervals, dayRule, skipRule, habitFreezes, tipPrefs, lateRule, balanceProfile, balanceProducts, balanceFoodLog, balanceDishes] =
    await Promise.all([
      read<Habit[]>(KEYS.habits, []),
      read<HabitLog[]>(KEYS.habitLog, []),
      read<EnergyLog[]>(KEYS.energy, []),
      read<FocusSession[]>(KEYS.sessions, []),
      read<number[]>(KEYS.milestones, []),
      read<string[]>(KEYS.freezes, []),
      read<RewardOption[]>(KEYS.rewardOptions, []),
      read<Reward[]>(KEYS.rewards, []),
      read<WeeklyReview[]>(KEYS.reviews, []),
      read<Task[]>(KEYS.tasks, []),
      read<number>(KEYS.screenTimeLimit, DEFAULT_SCREEN_TIME_LIMIT_MIN),
      api.getFocusIntervals(),
      api.getDayRule(),
      api.getSkipRule(),
      api.getHabitFreezes(),
      api.getTipPrefs(),
      api.getLateRule(),
      api.getBalanceProfile(),
      read<FoodProduct[]>(KEYS.balanceProducts, []),
      read<FoodEntry[]>(KEYS.balanceFoodLog, []),
      read<Dish[]>(KEYS.balanceDishes, []),
    ]);
  return {
    habits: [...habits].sort((a, b) => a.sortOrder - b.sortOrder),
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
    dayRule,
    skipRule,
    habitFreezes,
    tipPrefs,
    lateRule,
    balanceProfile,
    balanceProducts,
    balanceFoodLog,
    balanceDishes,
  };
}

/** Throws away everything on the device and writes the backup in its place. */
export async function replaceData(data: BackupData): Promise<ImportStats> {
  return withAllKeyLocks(async () => {
    await Promise.all([
      write(KEYS.habits, data.habits),
      write(KEYS.habitLog, data.habitLog),
      write(KEYS.energy, data.energy),
      write(KEYS.sessions, data.sessions),
      write(KEYS.milestones, data.milestones),
      write(KEYS.freezes, data.freezes),
      write(KEYS.rewardOptions, data.rewardOptions),
      write(KEYS.rewards, data.rewards),
      write(KEYS.reviews, data.reviews),
      write(KEYS.tasks, data.tasks),
      write(KEYS.screenTimeLimit, data.screenTimeLimitMinutes),
      write(KEYS.focusIntervals, data.focusIntervals),
      write(KEYS.dayRule, normalizeDayRule(data.dayRule)),
      write(KEYS.skipRule, normalizeSkipRule(data.skipRule)),
      write(KEYS.habitFreezes, data.habitFreezes),
      write(KEYS.tipPrefs, normalizeTipPrefs(data.tipPrefs)),
      write(KEYS.lateRule, normalizeLateRule(data.lateRule)),
      write(KEYS.balanceProfile, data.balanceProfile),
      write(KEYS.balanceProducts, data.balanceProducts),
      write(KEYS.balanceFoodLog, data.balanceFoodLog),
      write(KEYS.balanceDishes, data.balanceDishes),
    ]);
    return {
      habits: data.habits.length,
      habitLog: data.habitLog.length,
      sessions: data.sessions.length,
      energy: data.energy.length,
      rewards: data.rewards.length,
      reviews: data.reviews.length,
      tasks: data.tasks.length,
    };
  });
}

/**
 * Adds what the device doesn't have yet and leaves everything it does have
 * untouched — importing twice changes nothing the second time.
 *
 * Habits and rewards are matched by *label*, not id: a fresh install
 * seeds the same ten default habits with freshly generated ids, so matching
 * by id alone would duplicate every one of them and strand the imported
 * ticks on the copies. Log entries are re-pointed at the local ids through
 * that mapping.
 */
export async function mergeData(data: BackupData): Promise<ImportStats> {
  return withAllKeyLocks(async () => {
    const stats: ImportStats = { ...EMPTY_STATS };

    // --- habits, and the imported-id -> local-id map the logs need ---
    const habits = await read<Habit[]>(KEYS.habits, []);
    const localById = new Set(habits.map((h) => h.id));
    const localByLabel = new Map(habits.map((h) => [h.label, h.id] as const));
    const habitIdMap = new Map<string, string>();
    let nextOrder = habits.reduce((max, h) => Math.max(max, h.sortOrder), -1) + 1;

    for (const h of data.habits) {
      if (localById.has(h.id)) {
        habitIdMap.set(h.id, h.id);
      } else if (localByLabel.has(h.label)) {
        habitIdMap.set(h.id, localByLabel.get(h.label)!);
      } else {
        habits.push({ ...h, sortOrder: nextOrder++ });
        localById.add(h.id);
        localByLabel.set(h.label, h.id);
        habitIdMap.set(h.id, h.id);
        stats.habits++;
      }
    }
    if (stats.habits > 0) await write(KEYS.habits, habits);

    // --- habit log ---
    const logs = await read<HabitLog[]>(KEYS.habitLog, []);
    const seenLog = new Set(logs.map((l) => `${l.habitId}|${l.date}`));
    const usedLogIds = new Set(logs.map((l) => l.id));
    for (const l of data.habitLog) {
      const habitId = habitIdMap.get(l.habitId);
      if (!habitId) continue; // a tick for a habit the file itself doesn't carry
      const key = `${habitId}|${l.date}`;
      if (seenLog.has(key)) continue; // this device already has a verdict for that day
      seenLog.add(key);
      logs.push({ ...l, habitId, id: usedLogIds.has(l.id) ? uid() : l.id });
      usedLogIds.add(l.id);
      stats.habitLog++;
    }
    if (stats.habitLog > 0) await write(KEYS.habitLog, logs);

    // --- reward options (label-matched; not reported, they aren't history) ---
    const options = await read<RewardOption[]>(KEYS.rewardOptions, []);
    const optionLabels = new Set(options.map((o) => o.label));
    let addedOptions = 0;
    for (const o of data.rewardOptions) {
      if (optionLabels.has(o.label)) continue;
      options.push(o);
      optionLabels.add(o.label);
      addedOptions++;
    }
    if (addedOptions > 0) await write(KEYS.rewardOptions, options);

    // --- focus sessions ---
    const sessions = await read<FocusSession[]>(KEYS.sessions, []);
    const sessionIds = new Set(sessions.map((s) => s.id));
    for (const s of data.sessions) {
      if (sessionIds.has(s.id)) continue;
      sessions.push(s);
      sessionIds.add(s.id);
      stats.sessions++;
    }
    if (stats.sessions > 0) await write(KEYS.sessions, sessions);

    // --- energy (one value per date+hour) ---
    const energy = await read<EnergyLog[]>(KEYS.energy, []);
    const seenEnergy = new Set(energy.map((e) => `${e.date}|${e.hour}`));
    for (const e of data.energy) {
      const key = `${e.date}|${e.hour}`;
      if (seenEnergy.has(key)) continue;
      seenEnergy.add(key);
      energy.push(e);
      stats.energy++;
    }
    if (stats.energy > 0) await write(KEYS.energy, energy);


    // --- rewards ---
    const rewards = await read<Reward[]>(KEYS.rewards, []);
    const rewardIds = new Set(rewards.map((r) => r.id));
    for (const r of data.rewards) {
      if (rewardIds.has(r.id)) continue;
      rewards.push(r);
      rewardIds.add(r.id);
      stats.rewards++;
    }
    if (stats.rewards > 0) await write(KEYS.rewards, rewards);

    // --- weekly reviews (one per ISO week) ---
    const reviews = await read<WeeklyReview[]>(KEYS.reviews, []);
    const seenWeeks = new Set(reviews.map((r) => r.week));
    for (const r of data.reviews) {
      if (seenWeeks.has(r.week)) continue;
      seenWeeks.add(r.week);
      reviews.push(r);
      stats.reviews++;
    }
    if (stats.reviews > 0) await write(KEYS.reviews, reviews);

    // --- tasks ---
    const tasks = await read<Task[]>(KEYS.tasks, []);
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const t of data.tasks) {
      if (taskIds.has(t.id)) continue;
      tasks.push(t);
      taskIds.add(t.id);
      stats.tasks++;
    }
    if (stats.tasks > 0) await write(KEYS.tasks, tasks);

    // --- celebrated milestones: union, so a milestone isn't re-celebrated ---
    const milestones = await read<number[]>(KEYS.milestones, []);
    const merged = [...new Set([...milestones, ...data.milestones])].sort((a, b) => a - b);
    if (merged.length !== milestones.length) await write(KEYS.milestones, merged);

    // --- freezes: union as well. A freeze is a fact about a day, so two devices that each
    // spent one in the same week both keep theirs; the weekly budget guards granting new
    // ones, not importing days that were already spent. ---
    const freezes = await read<string[]>(KEYS.freezes, []);
    const mergedFreezes = [...new Set([...freezes, ...data.freezes])].sort();
    if (mergedFreezes.length !== freezes.length) await write(KEYS.freezes, mergedFreezes);

    // --- per-habit freezes: the same union, per habit. Ids are matched as they are rather
    // than through the label map above, so a chance spent on a habit this device does not
    // have is carried harmlessly and lines up if that habit ever arrives. ---
    const habitFreezes = await read<Record<string, string[]>>(KEYS.habitFreezes, {});
    let habitFreezesChanged = false;
    for (const [id, days] of Object.entries(data.habitFreezes)) {
      const current = Array.isArray(habitFreezes[id]) ? habitFreezes[id] : [];
      const merged = [...new Set([...current, ...days])].sort();
      if (merged.length !== current.length) {
        habitFreezes[id] = merged;
        habitFreezesChanged = true;
      }
    }
    if (habitFreezesChanged) await write(KEYS.habitFreezes, habitFreezes);

    // The screen-time limit is a setting of *this* phone, not history — merging
    // deliberately leaves it alone.
    return stats;
  });
}
