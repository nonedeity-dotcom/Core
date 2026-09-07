import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { dateNDaysAgo, formatDateShort } from "../lib/date";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { HABIT_WINDOW_DAYS, habitStats } from "../lib/habitStats";
import { habitTarget } from "../lib/habits";
import HistoryCalendar from "../components/HistoryCalendar";
import { frozenDaysFor } from "../lib/useStreak";
import type { Habit, HabitLog } from "../types";

/**
 * One habit's own history, which the global streak cannot show.
 *
 * The report's big number answers "did the whole system hold today" — so a habit added a
 * week into a 40-day run inherits that 40 and reads as settled when it is three days old.
 * This counts only its own days, from the first one it was actually done.
 */
export default function HabitReportScreen({ route }: { route: { params: { habitId: string } } }) {
  const today = useTodayKey();
  const habitId = route.params.habitId;

  // Both lists: this screen opens from the archive as well as from the report, and an
  // archived habit is exactly the one whose history is worth looking at.
  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits", "all"],
    queryFn: () => api.getAllHabits() as Promise<Habit[]>,
  });
  const windowStart = dateNDaysAgo(HABIT_WINDOW_DAYS);
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "streak", windowStart, today],
    queryFn: () => api.getHabitLog(windowStart, today) as Promise<HabitLog[]>,
  });
  const { data: freezes = [] } = useQuery<string[]>({
    queryKey: ["freezes"],
    queryFn: () => api.getFreezes(),
  });
  const { data: habitFreezes = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["habitFreezes"],
    queryFn: () => api.getHabitFreezes(),
  });

  const habit = habits.find((h) => h.id === habitId);
  if (!habit) return null;
  const archived = !!habit.archivedAt;

  // The shared days off plus the chances this habit spent on itself.
  const excused = frozenDaysFor(habit.id, freezes, habitFreezes);
  const stats = habitStats(habit, logs, today, excused);
  const target = habitTarget(habit);

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.number}>{stats.streak}</Text>
        <Text style={styles.unit}>
          {stats.unit === "days"
            ? `${plural(stats.streak, ["день", "дня", "дней"])} подряд`
            : `${plural(stats.streak, ["неделя", "недели", "недель"])} подряд`}
        </Text>
        <Text style={styles.since}>
          {stats.firstDay
            ? `идёт с ${formatDateShort(stats.firstDay)} · ${stats.daysSinceStart}-й день`
            : "ещё ни разу не отмечена"}
        </Text>
        {archived && <Text style={styles.archived}>в архиве — не влияет на зачёт дня</Text>}
        <Text style={styles.target}>
          {target.kind === "daily"
            ? `${target.count} ${plural(target.count, ["раз", "раза", "раз"])} в день`
            : `${target.count} ${plural(target.count, ["раз", "раза", "раз"])} в неделю`}
        </Text>
      </View>

      {/* Only this habit — the question here is "when did I skip *this*", not whether the
          day as a whole counted. */}
      <HistoryCalendar today={today} habits={habits} habit={habit} frozen={excused} alwaysOpen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 8 },
  head: { alignItems: "center", paddingVertical: 18 },
  number: { color: colors.accentGreen, fontSize: 44, fontWeight: "700", letterSpacing: -1 },
  unit: { color: colors.text, fontSize: 14, marginTop: 2 },
  since: { color: colors.textMuted, fontSize: 12, marginTop: 10, textAlign: "center" },
  target: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  archived: { color: colors.textMuted, fontSize: 11, marginTop: 6, fontStyle: "italic" },
});
