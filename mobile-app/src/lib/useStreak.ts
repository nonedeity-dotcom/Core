import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { dateNDaysAgo } from "./date";
import { announcePhase } from "../notifications/phaseAlerts";
import { computeStreak, freezeCandidate, STREAK_WINDOW_DAYS } from "./streak";
import { DEFAULT_DAY_RULE, type DayRule } from "./dayRule";
import { DEFAULT_SKIP_RULE, type SkipRule } from "./skipRule";
import { DEFAULT_DAY_OFF, type DayOffRule } from "./dayOff";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "./level";
import { habitFreezeCandidate } from "./habitStats";
import type { Habit, HabitLog } from "../types";

/**
 * The streak, and the one place a weekly freeze is granted.
 *
 * Both screens that show the number use this, so they cannot disagree, and the query keys
 * match the report's own — React Query serves all of them from one cached fetch rather than
 * pulling four months of logs per screen.
 *
 * Granting is a write, deliberately: a freeze re-derived on every render would let the
 * streak change under someone who had already read it, and "one a week" would mean nothing.
 */
export function useStreak(today: string): {
  streak: number;
  habits: Habit[];
  logs: HabitLog[];
  freezes: string[];
  rule: DayRule;
  /** Сколько каждого уровня нужно за день и за неделю — вторая половина приговора дня. */
  levelRule: LevelRule;
  skipRule: SkipRule;
  /** Days each habit spent one of its own chances on, by habit id. */
  habitFreezes: Record<string, string[]>;
  daysOff: DayOffRule;
} {
  const qc = useQueryClient();
  const windowStart = dateNDaysAgo(STREAK_WINDOW_DAYS);

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: logs = [], isSuccess: logsLoaded } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "streak", windowStart, today],
    queryFn: () => api.getHabitLog(windowStart, today) as Promise<HabitLog[]>,
  });
  const { data: freezes = [], isSuccess: freezesLoaded } = useQuery<string[]>({
    queryKey: ["freezes"],
    queryFn: () => api.getFreezes(),
  });
  // How much of the pile closes a day is a setting now, and every verdict below depends on
  // it. Until it has loaded the default is the honest answer, not a guess at the stored one.
  const { data: rule = DEFAULT_DAY_RULE, isSuccess: ruleLoaded } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });
  // Вторая половина того же приговора. Пока не загрузилась — нули, то есть «уровни ничего
  // не требуют»: это и есть честный ответ до того, как настройка прочитана.
  const { data: levelRule = DEFAULT_LEVEL_RULE, isSuccess: levelLoaded } = useQuery<LevelRule>({
    queryKey: ["levelRule"],
    queryFn: () => api.getLevelRule(),
  });
  const { data: skipRule = DEFAULT_SKIP_RULE, isSuccess: skipLoaded } = useQuery<SkipRule>({
    queryKey: ["skipRule"],
    queryFn: () => api.getSkipRule(),
  });
  const { data: habitFreezes = {}, isSuccess: habitFreezesLoaded } = useQuery<Record<string, string[]>>({
    queryKey: ["habitFreezes"],
    queryFn: () => api.getHabitFreezes(),
  });
  const { data: daysOff = DEFAULT_DAY_OFF, isSuccess: daysOffLoaded } = useQuery<DayOffRule>({
    queryKey: ["daysOff"],
    queryFn: () => api.getDaysOff(),
  });

  // Both writes below act on the streak, and a streak read before the logs arrive is 0 —
  // which is not "the chain is broken", it is "we don't know yet". Acting on it would clear
  // the record of what has been announced on every single launch, and re-send the stretch's
  // notification each time.
  const ready =
    habits.length > 0 &&
    logsLoaded &&
    freezesLoaded &&
    ruleLoaded &&
    levelLoaded &&
    skipLoaded &&
    habitFreezesLoaded &&
    // Без выходных нельзя решать, тратить ли шанс: вчера могло быть объявлено нерабочим,
    // и тогда платить не за что. Потратить шанс зря — это списание, которое не вернуть.
    daysOffLoaded;

  useEffect(() => {
    if (!ready) return;
    const candidate = freezeCandidate(habits, logs, freezes, today, rule, levelRule, skipRule, daysOff);
    if (!candidate) return;
    api.grantFreeze(candidate).then(() => qc.invalidateQueries({ queryKey: ["freezes"] }));
  }, [ready, habits, logs, freezes, today, rule, levelRule, skipRule, daysOff, qc]);

  // Вторая половина того же начисления — на каждую привычку. Теперь обе половины работают
  // одновременно, а не по очереди: день и привычка защищены порознь, и запасы у них свои.
  // Пишется в тот момент, когда вчера закрылось, а не выводится на каждой отрисовке, — иначе
  // число могло бы измениться под тем, кто его уже прочитал.
  useEffect(() => {
    if (!ready || skipRule.perHabit.count <= 0) return;
    for (const habit of habits) {
      // Two lists on purpose: everything the habit is let off, and separately the chances
      // it has spent itself. A shared day off already granted must not come out of this
      // habit's own budget — it was granted by the other rule entirely.
      const day = habitFreezeCandidate(
        habit,
        logs,
        frozenDaysFor(habit.id, freezes, habitFreezes),
        habitFreezes[habit.id] ?? [],
        skipRule,
        daysOff,
      );
      if (!day) continue;
      api.grantHabitFreeze(habit.id, day).then(() => qc.invalidateQueries({ queryKey: ["habitFreezes"] }));
    }
  }, [ready, habits, logs, freezes, habitFreezes, skipRule, daysOff, qc]);

  const streak = computeStreak(habits, logs, freezes, rule, levelRule, daysOff);

  // Announcing the stretch is also a write (it records what has been said), so it belongs
  // here beside the freeze rather than in a screen that might mount twice.
  useEffect(() => {
    if (!ready) return;
    announcePhase(streak);
  }, [ready, streak]);

  return { streak, habits, logs, freezes, rule, levelRule, skipRule, habitFreezes, daysOff };
}

/**
 * Every day one habit is excused from: the shared days off, plus the chances that habit
 * spent on itself.
 *
 * Both, always, whatever mode is set now. A day the app forgave under one setting stays
 * forgiven under the next — the record of what was granted is history, not a preference.
 */
export function frozenDaysFor(
  habitId: string,
  freezes: string[],
  habitFreezes: Record<string, string[]>,
): string[] {
  const own = habitFreezes[habitId];
  return own && own.length > 0 ? [...new Set([...freezes, ...own])] : freezes;
}
