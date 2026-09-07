/**
 * Which pile a habit or a trigger sits in.
 *
 * The point of the split is that a list of ten things you eventually want is not a list of
 * ten things you are doing. Only "now" decides whether a day counts; "extra" can be ticked
 * for the record but never blocks a day; "later" is a plan, not a task.
 */
export type ItemGroup = "now" | "extra" | "later";

/** How often a habit is owed: N times a day, or N times across the week. */
export interface HabitTarget {
  kind: "daily" | "weekly";
  count: number;
}

/**
 * When a habit is supposed to happen.
 *
 * Everything is optional, and absent means "whenever" — which is what every habit meant
 * before this existed. Minutes from midnight rather than a string, so comparing is comparing
 * and the timezone never enters into it: the window is read against the phone's own clock,
 * the same clock that decides which day it is.
 */
export interface HabitSchedule {
  /** Start of the window, or the deadline itself when `to` is absent. */
  from?: number;
  /** End of the window. Absent means `from` is a deadline: do it by then. */
  to?: number;
  /**
   * ISO weekdays (1 = Monday) this habit is expected on. Only meaningful for a weekly
   * habit — a daily one is owed every day by definition, and letting days narrow that would
   * be a second, contradictory way of saying how often.
   */
  days?: number[];
  /**
   * What missing this habit's window costs — its own answer, not the app's.
   *
   * Absent means "whatever the default in «Настройки админа» says", which is how one setting
   * can cover most habits while the odd one disagrees: an hour without the phone in the
   * morning is a promise worth losing the day over, and "выпить воды" at the same hour is
   * not. Lives inside the schedule because without a window it means nothing, and clearing
   * the window should clear it too.
   */
  late?: "none" | "fail";
}

export interface Habit {
  id: string;
  label: string;
  hint?: string | null;
  /**
   * The cut-down version for bad days — step 4 of the source's "точка
   * возврата" protocol. Declared in advance on purpose: on the day you
   * actually need it, you won't invent one.
   */
  minimal?: string | null;
  sortOrder: number;
  /** Defaults to "now" — every habit that existed before the split was one you were doing. */
  group?: ItemGroup;
  /**
   * Defaults to once a day, which is what every habit meant before targets existed.
   *
   * A weekly target never blocks a day: "спорт 3 раза в неделю" would otherwise fail every
   * day you don't train, which is most of them. It is counted and shown across the week
   * instead, and the day's verdict looks only at daily habits.
   */
  target?: HabitTarget;
  /** When set, this habit's done-state for today is managed automatically
   *  instead of by tapping — currently only "screentime" (from creker), see
   *  src/integrations/screenTime.ts. */
  auto?: "screentime" | null;
  /**
   * When in the day — and, for a weekly habit, on which days — it is supposed to happen.
   *
   * Absent means whenever, which is what every habit meant before this existed and what most
   * of them should go on meaning: a time is worth setting for the ones that only work at a
   * particular hour, and for the rest it is a rule with nothing behind it. What a missed
   * window costs is a separate setting, not a property of the habit — see LateRule.
   */
  schedule?: HabitSchedule;
  /**
   * The local date the habit joined the checklist.
   *
   * A day is judged against the habits that existed on it. Without this, the streak walked
   * backwards judging every past day by *today's* list — so adding one habit re-judged
   * yesterday against a habit that had not been invented yet, found it unticked, and wiped
   * the whole chain. Backfilled once for habits from before this field existed; see
   * migrateHabitCreatedAt.
   */
  createdAt?: string;
  /**
   * The local date the habit *re-entered* the checklist, when that is later than when it
   * was created.
   *
   * `createdAt` alone answers "since when is this owed?" only for a habit that has been in
   * the «ввожу сейчас» pile the whole time. Move an old habit out of that pile and back in,
   * or restore one from the archive, and it starts answering for every day it was away —
   * days it was never going to be ticked on, because it was not on the list. One move
   * turned a three-day chain into zero.
   *
   * So the day a habit is owed from is the later of the two. Absent means it has never
   * left, which is the ordinary case.
   */
  nowSince?: string;
  /**
   * ISO timestamp of when the habit was put aside, or absent while it is in the checklist.
   *
   * The bin used to wipe the habit and every mark it ever had, which made "I'm not doing
   * this one any more" and "this was a mistake, erase it" the same button. Archiving keeps
   * the marks, so the habit's own report survives being retired — erasing for good is a
   * second, deliberate step, taken from the archive.
   */
  archivedAt?: string | null;
}

export interface HabitLog {
  id: string;
  habitId: string;
  date: string; // ISO date
  /**
   * Kept as the plain "did it happen at all" flag every other part of the app already reads
   * — the calendar, the streak, the report. With targets it means `count` reached the
   * habit's daily target.
   */
  done: boolean;
  /**
   * How many times it was done that day. Absent on rows written before targets existed, so
   * readers fall back to `done ? 1 : 0` rather than treating an old day as zero.
   */
  count?: number;
  /**
   * True when the day was closed with the minimal version rather than the
   * full one. Still counts for the streak — the source's whole point is that
   * a small day beats a broken chain — but the report shows the difference so
   * a month of minimums doesn't read as a month of full days.
   */
  minimal?: boolean;
  /**
   * True when a person set this state by tapping, rather than it being filled in from
   * creker's screen-time numbers. Only the auto-ticked habit ever has it, and it is what
   * stops the sync from overruling a deliberate untick on the next visit to the tab —
   * before this, unticking "Экранное время в норме" lasted until you switched tabs.
   */
  manual?: boolean;
}

export interface EnergyLog {
  date: string;
  hour: number;
  value: number;
}

export interface FocusSession {
  id: string;
  date: string;
  durationMin: number;
  completedAt: string;
}


/**
 * A thing to do, tagged by what it demands of you.
 *
 * The source measures energy hour by hour and then says: put analytical work
 * on the peaks and routine on the dips. The app measured and then did nothing
 * with the measurement — this is what closes that loop. Undated on purpose:
 * it is a planning aid for the day in front of you, not another history to
 * keep.
 */
export interface Task {
  id: string;
  label: string;
  /** "hard" wants a peak hour; "routine" is fine in a dip. */
  kind: "hard" | "routine";
  done: boolean;
}

/**
 * Step 5 of the "точка возврата" protocol: once a week, on a calm head,
 * look at what worked and change one thing. Stored per ISO week rather than
 * per date so a review written on Sunday and one written on Monday morning
 * don't become two separate weeks.
 */
export interface WeeklyReview {
  /** "2026-W35" — see src/lib/week.ts. */
  week: string;
  worked: string;
  didnt: string;
  change: string;
  /** Local date the review was written, for the history list. */
  date: string;
}

export interface RewardOption {
  id: string;
  label: string;
}

export interface Reward {
  id: string;
  date: string;
  text: string;
}
