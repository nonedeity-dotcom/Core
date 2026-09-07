import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { dateNDaysAgo } from "./date";
import { announcePhase } from "../notifications/phaseAlerts";
import { computeStreak, freezeCandidate, STREAK_WINDOW_DAYS } from "./streak";
import { DEFAULT_DAY_RULE, type DayRule } from "./dayRule";
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

  // Both writes below act on the streak, and a streak read before the logs arrive is 0 —
  // which is not "the chain is broken", it is "we don't know yet". Acting on it would clear
  // the record of what has been announced on every single launch, and re-send the stretch's
  // notification each time.
  const ready = habits.length > 0 && logsLoaded && freezesLoaded && ruleLoaded;

  useEffect(() => {
    if (!ready) return;
    const candidate = freezeCandidate(habits, logs, freezes, today, rule);
    if (!candidate) return;
    api.grantFreeze(candidate).then(() => qc.invalidateQueries({ queryKey: ["freezes"] }));
  }, [ready, habits, logs, freezes, today, rule, qc]);

  const streak = computeStreak(habits, logs, freezes, rule);

  // Announcing the stretch is also a write (it records what has been said), so it belongs
  // here beside the freeze rather than in a screen that might mount twice.
  useEffect(() => {
    if (!ready) return;
    announcePhase(streak);
  }, [ready, streak]);

  return { streak, habits, logs, freezes, rule };
}
