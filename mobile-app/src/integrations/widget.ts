import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { todayKey } from "../lib/date";
import { perDayTarget } from "../lib/habits";
import { parseTaps, tapsToApply, widgetSnapshot } from "../lib/widget";
import { setWidgetSnapshot, takeWidgetTaps, widgetAvailable } from "../../modules/core-widget";
import type { Habit, HabitLog } from "../types";

/**
 * Нажатия с виджета — в чек-лист, по одному, как если бы это был палец.
 *
 * Каждое нажатие — отдельный шаг вверх через тот же bumpHabit: у счётной привычки «вода
 * 3 раза» три нажатия на виджете — это три, а не одно. Дальше цели шаг не идёт, так что
 * лишнее нажатие ничего не ломает.
 */
export async function applyWidgetTaps(): Promise<number> {
  const taps = parseTaps(takeWidgetTaps());
  if (taps.length === 0) return 0;
  const habits = await api.getHabits();
  const todo = tapsToApply(taps, habits);
  for (const { habit, date } of todo) await api.bumpHabit(habit.id, date, perDayTarget(habit));
  return todo.length;
}

/**
 * Держит виджет в курсе: забирает нажатия при каждом открытии и отдаёт свежий слепок при
 * каждой перемене в привычках или отметках за сегодня.
 */
export function useWidgetSync(): void {
  const qc = useQueryClient();
  const today = todayKey();
  const { data: habits } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
    enabled: widgetAvailable,
  });
  const { data: logs } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", today],
    queryFn: () => api.getHabitLog(today, today) as Promise<HabitLog[]>,
    enabled: widgetAvailable,
  });

  useEffect(() => {
    if (!widgetAvailable) return;
    const pull = () => {
      void applyWidgetTaps().then((n) => {
        if (n > 0) void qc.invalidateQueries({ queryKey: ["habitLog"] });
      });
    };
    pull();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") pull();
    });
    return () => sub.remove();
  }, [qc]);

  useEffect(() => {
    if (!widgetAvailable || !habits || !logs) return;
    setWidgetSnapshot(JSON.stringify(widgetSnapshot(habits, logs, today)));
  }, [habits, logs, today]);
}
