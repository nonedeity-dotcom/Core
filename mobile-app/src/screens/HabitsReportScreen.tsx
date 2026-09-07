import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { useStreak, frozenDaysFor } from "../lib/useStreak";
import { habitStats } from "../lib/habitStats";
import { habitStanding, standingRank, type HabitStanding } from "../lib/habitStanding";
import { habitGroup } from "../lib/habits";
import { weekDatesThrough } from "../lib/week";
import type { Habit, ItemGroup } from "../types";

/**
 * Every habit's own run, on a screen of its own.
 *
 * It used to be a fold on the report, which pushed the focus sessions and the weekly review
 * off the bottom of a screen that opens on a number — and gave a list of ten habits about a
 * third of the height it wanted. The report keeps a row that leads here.
 *
 * Order inside each pile answers the two questions you come here with: what will break
 * tonight if nothing is done, and what is already finished. Urgent on top, done at the
 * bottom and dimmed. Deliberately not folded away like the checklist does — there the point
 * is what is left to do, here it is how each one is going, and hiding the finished ones
 * would hide half the report.
 */
const GROUPS: { id: ItemGroup; title: string }[] = [
  { id: "now", title: "Ввожу сейчас" },
  { id: "extra", title: "Дополнительно" },
];

export default function HabitsReportScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: object) => void };
}) {
  const today = useTodayKey();
  const { habits, logs, freezes, skipRule, habitFreezes } = useStreak(today);

  // Monday through today — what a weekly habit's count is taken over.
  const weekDates = weekDatesThrough(today);

  const rows = habits.map((habit) => {
    const excused = frozenDaysFor(habit.id, freezes, habitFreezes);
    const own = habitFreezes[habit.id] ?? [];
    return {
      habit,
      stats: habitStats(habit, logs, today, excused),
      standing: habitStanding(habit, logs, { today, excused, own, rule: skipRule, weekDates }),
    };
  });

  const urgent = rows.filter((r) => r.standing.bucket === "urgent").length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.intro}>
        {urgent > 0
          ? `${urgent} ${plural(urgent, ["привычка ждёт", "привычки ждут", "привычек ждут"])} сегодня — иначе серия оборвётся.`
          : "Своя серия у каждой привычки: та, что наверху, ничего не наследует от общей."}
      </Text>

      {GROUPS.map((group) => {
        const inGroup = rows
          .filter((r) => habitGroup(r.habit) === group.id)
          // Stable: rank first, and the checklist's own order inside each rank.
          .sort((a, b) => standingRank(a.standing.bucket) - standingRank(b.standing.bucket));
        if (inGroup.length === 0) return null;

        return (
          <View key={group.id}>
            {/* Named even when only one pile has anything in it: "Дополнительно" not
                counting towards the day is the whole reason these are separated. */}
            <Text style={styles.groupLabel}>{group.title}</Text>
            {inGroup.map(({ habit, stats, standing }) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                streak={stats.streak}
                unit={stats.unit}
                week={stats.week}
                standing={standing}
                onPress={() => navigation.navigate("HabitReport", { habitId: habit.id, title: habit.label })}
              />
            ))}
          </View>
        );
      })}

      {rows.length === 0 && <Text style={styles.empty}>Пока нечего показывать — в чек-листе нет привычек.</Text>}
    </ScrollView>
  );
}

function HabitRow({
  habit,
  streak,
  unit,
  week,
  standing,
  onPress,
}: {
  habit: Habit;
  streak: number;
  unit: "days" | "weeks";
  week: boolean[];
  standing: HabitStanding;
  onPress: () => void;
}) {
  const urgent = standing.bucket === "urgent";
  const done = standing.bucket === "done";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${habit.label}: ${streak}${standing.note ? `, ${standing.note}` : ""}`}
      style={({ pressed }) => [
        styles.habitRow,
        urgent && styles.habitRowUrgent,
        done && styles.habitRowDone,
        pressed && styles.pressedRow,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.habitName} numberOfLines={1}>
          {habit.label}
        </Text>
        <Text style={styles.subtleSmall}>
          {streak > 0
            ? unit === "days"
              ? `${streak} ${plural(streak, ["день", "дня", "дней"])} подряд`
              : `${streak} ${plural(streak, ["неделя", "недели", "недель"])} подряд`
            : "серии пока нет"}
        </Text>
        {standing.note && (
          <View style={styles.noteRow}>
            {urgent && <Feather name="alert-triangle" size={10} color={colors.accent} />}
            <Text style={[styles.note, urgent && styles.noteUrgent]}>{standing.note}</Text>
          </View>
        )}
      </View>
      {/* Seven dots, oldest on the left — a week at a glance without opening it. */}
      <View style={styles.strip}>
        {week.map((day, i) => (
          <View key={i} style={[styles.stripDot, day && styles.stripDotOn]} />
        ))}
      </View>
      <Feather name="chevron-right" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  groupLabel: { color: colors.textMuted, fontSize: 11, marginTop: 10, marginBottom: 6 },
  subtleSmall: { color: colors.textMuted, fontSize: 11 },
  empty: { color: colors.textMuted, fontSize: 12 },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  // Warm accent, the app's "this wants attention" colour — an edge, not a filled card.
  habitRowUrgent: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  // Finished ones stay readable but stop competing: they are at the bottom for a reason.
  habitRowDone: { opacity: 0.55 },
  pressedRow: { opacity: 0.75 },
  habitName: { color: colors.text, fontSize: 14, fontWeight: "500" },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  note: { color: colors.textMuted, fontSize: 11 },
  noteUrgent: { color: colors.accent, fontWeight: "600" },
  strip: { flexDirection: "row", gap: 4 },
  stripDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.cardBorder },
  stripDotOn: { backgroundColor: colors.accentGreen },
});
