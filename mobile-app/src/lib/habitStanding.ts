import { dateNDaysAgo } from "./date";
import { habitTarget, logCount, perDayTarget, weeklyProgress } from "./habits";
import { habitSkipsLeft, habitStreakDays } from "./habitStats";
import { DEFAULT_SKIP_RULE, type SkipRule } from "./skipRule";
import { dayOfWeek } from "./week";
import type { Habit, HabitLog } from "../types";

/**
 * Where a habit stands right now, for the list that reports on all of them.
 *
 * Two questions at once, because they decide the same thing — the order of the list.
 * "Is it done" sinks the finished ones to the bottom; "can today still be saved" lifts the
 * ones that will lose their run tonight to the top.
 */
export type StandingBucket =
  /** Miss today and the run is gone, with nothing left to cover it. */
  | "urgent"
  /** Ordinary: still owed today, and a slip would survive. */
  | "open"
  /**
   * Not owed *today*: a weekly habit you could skip and still close the week. It sits below
   * the things that are owed today and above the finished ones — not done, just not now.
   */
  | "later"
  /** Nothing more owed today (or this week, for a weekly habit). */
  | "done";

export interface HabitStanding {
  bucket: StandingBucket;
  /** The line under the name, or null when there is nothing worth saying. */
  note: string | null;
}

const ORDER: Record<StandingBucket, number> = { urgent: 0, open: 1, later: 2, done: 3 };

/** Sort key, so the list and any test agree on what "sinks" means. */
export function standingRank(bucket: StandingBucket): number {
  return ORDER[bucket];
}

function doneOnDate(habit: Habit, logs: HabitLog[], date: string): boolean {
  const log = logs.find((l) => l.habitId === habit.id && l.date === date);
  return logCount(log) >= perDayTarget(habit);
}

/**
 * A weekly habit's standing is arithmetic, not chances: it never gets any, because a missed
 * day is not a missed week. What can be said is whether the week is still reachable.
 */
function weeklyStanding(
  habit: Habit,
  logs: HabitLog[],
  today: string,
  weekDates: string[],
): HabitStanding {
  const target = habitTarget(habit).count;
  const done = weeklyProgress(habit, logs, weekDates).count;
  const need = target - done;
  if (need <= 0) return { bucket: "done", note: `за неделю ${done} из ${target} — закрыта` };

  // Today through Sunday, today included.
  const daysLeft = 8 - dayOfWeek(today);
  const days = (n: number) => `${n} ${n === 1 ? "день" : n < 5 ? "дня" : "дней"}`;

  if (need > daysLeft) {
    // Not urgent — urgent means "doing it now helps", and here nothing does.
    return { bucket: "later", note: `за неделю ${done} из ${target} — до конца недели уже не успеть` };
  }
  if (need === daysLeft) {
    return {
      bucket: "urgent",
      note:
        daysLeft === 1
          ? `последний день недели — нужен ещё ${need === 1 ? "раз" : `${need} раза`}`
          : `нужны все оставшиеся ${days(daysLeft)} — иначе неделя не закроется`,
    };
  }
  // The slack itself is the point: this is why it sinks below what is owed today.
  return { bucket: "later", note: `за неделю ${done} из ${target} · ещё ${days(daysLeft)}` };
}

export interface StandingInput {
  today: string;
  /** Every day this habit is let off: the shared days plus its own spent chances. */
  excused: string[];
  /** Only the chances this habit spent itself. */
  own: string[];
  rule: SkipRule;
  /** Monday through today — what a weekly habit's count is taken over. */
  weekDates: string[];
}

export function habitStanding(habit: Habit, logs: HabitLog[], input: StandingInput): HabitStanding {
  const { today, excused, own, rule, weekDates } = input;

  if (habitTarget(habit).kind === "weekly") return weeklyStanding(habit, logs, today, weekDates);

  if (doneOnDate(habit, logs, today)) return { bucket: "done", note: "сегодня закрыта" };

  // Nothing to lose yet: a habit with no run cannot break one tonight.
  const streak = habitStreakDays(habit, logs, excused);
  if (streak === 0) return { bucket: "open", note: null };

  // Choice B: in the shared mode the chance belongs to the *day*, not to this habit, so
  // "у этой привычки не осталось шансов" would be the wrong sentence. Nothing is said.
  if (rule.mode !== "perHabit" || rule.count <= 0) return { bucket: "open", note: null };

  // Whether a miss today could be forgiven tomorrow morning — the same two conditions the
  // grant itself checks, read a day early.
  const yesterdayExcused = excused.includes(dateNDaysAgo(1));
  const left = habitSkipsLeft(habit, logs, excused, own, rule);

  if (yesterdayExcused) {
    // Two days running are never covered, whatever the budget says.
    return { bucket: "urgent", note: "сегодня обязательно — вчера уже прощён" };
  }
  if (left <= 0) return { bucket: "urgent", note: "сегодня обязательно — шансов не осталось" };
  if (left === 1) return { bucket: "open", note: "остался 1 шанс" };
  return { bucket: "open", note: `шансов: ${left}` };
}
