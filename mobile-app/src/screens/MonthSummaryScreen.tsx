import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { countedDates } from "../lib/streak";
import { monthFacts } from "../lib/stats";
import { DEFAULT_DAY_RULE, type DayRule } from "../lib/dayRule";
import { DEFAULT_DAY_OFF, type DayOffRule } from "../lib/dayOff";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "../lib/level";
import GoalChecklist from "../components/GoalChecklist";
import {
  emptyGoal,
  findGoal,
  goalProgress,
  monthKey,
  monthRange,
  periodPrepositional,
  periodTitle,
  type PeriodGoal,
} from "../lib/goals";
import type { Habit, HabitLog } from "../types";

/**
 * Итог месяца: что было задумано, что из этого отмечено и что человек сам об этом думает.
 *
 * Цифры сверху — не оценка, а память. «Вроде нормально прошёл» и «закрыто 19 из 30, два
 * шанса» — это два разных итога, и второй пишется честнее. Считать по ним ничего не нужно:
 * всё то же самое, только подробнее, лежит в «Статистике».
 *
 * Галочки здесь ставятся, но пункты не добавляются и не удаляются: итог — это разговор про
 * то, что было, а не место, где задним числом переписывают, что планировалось.
 */
export default function MonthSummaryScreen({ route }: { route: { params: { period: string } } }) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const period = route.params.period;
  const range = monthRange(period);
  // Незакончившийся месяц считается по сегодняшний день: «закрыто 19 из 30» двадцать
  // восьмого числа — это упрёк за два дня, которых ещё не было.
  const to = range.to < today ? range.to : today;

  const { data: goals = [] } = useQuery<PeriodGoal[]>({ queryKey: ["goals"], queryFn: () => api.getGoals() });
  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "month", range.from, to],
    queryFn: () => api.getHabitLog(range.from, to) as Promise<HabitLog[]>,
  });
  const { data: freezes = [] } = useQuery<string[]>({ queryKey: ["freezes"], queryFn: () => api.getFreezes() });
  const { data: dayRule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });
  const { data: levelRule = DEFAULT_LEVEL_RULE } = useQuery<LevelRule>({
    queryKey: ["levelRule"],
    queryFn: () => api.getLevelRule(),
  });
  const { data: daysOff = DEFAULT_DAY_OFF } = useQuery<DayOffRule>({
    queryKey: ["daysOff"],
    queryFn: () => api.getDaysOff(),
  });

  const stored = findGoal(goals, period);
  const goal = stored ?? emptyGoal(period, today);
  const facts = monthFacts(countedDates(habits, logs, dayRule, levelRule), freezes, range.from, to, daysOff);
  const progress = goalProgress(stored);

  const [text, setText] = useState("");
  // То же, что на экране цели: «Сохранено» не должно стоять над текстом, который с тех пор
  // успели дописать.
  const [dirty, setDirty] = useState(false);
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === period) return;
    loadedFor.current = period;
    if (stored) setText(stored.summary);
  }, [period, stored]);

  const save = useMutation({
    mutationFn: (next: PeriodGoal) => api.saveGoal(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });

  const commitSummary = () => {
    const summary = text.trim();
    setDirty(false);
    save.mutate({
      ...goal,
      summary,
      // Дата итога — то, по чему его отличают от «ещё не написан». Стирается вместе с
      // текстом: пустой итог с датой выглядел бы написанным и больше не просился бы.
      summaryDate: summary ? today : "",
      updatedAt: today,
    });
  };

  const toggle = (id: string) => {
    save.mutate({
      ...goal,
      items: goal.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
      updatedAt: today,
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        {range.to < today
          ? `${periodTitle(period)} закончился. Пока помнится — коротко, что из этого вышло.`
          : `${periodTitle(period)} заканчивается. Подводить итог на холодную голову проще, чем потом вспоминать.`}
      </Text>

      <View style={styles.card}>
        <View style={styles.statRow}>
          <Stat value={`${facts.closed}`} label={`из ${facts.days} ${plural(facts.days, ["дня", "дней", "дней"])} закрыто`} accent />
          <Stat value={`${facts.best}`} label="лучшая серия в месяце" />
        </View>
        <Text style={styles.note}>
          {facts.skips === 0 && facts.off === 0
            ? "Ни одного шанса и ни одного выходного за месяц."
            : `Потрачено ${facts.skips} ${plural(facts.skips, ["шанс", "шанса", "шансов"])}` +
              `, выходных — ${facts.off}. Подробнее — в «Статистике».`}
        </Text>
      </View>

      {progress.total > 0 && (
        <>
          <View style={styles.stepsHead}>
            <Text style={styles.label}>Что задумывалось</Text>
            <Text style={styles.progress}>
              {progress.done} из {progress.total}
            </Text>
          </View>
          {goal.main ? <Text style={styles.main}>{goal.main}</Text> : null}
          <GoalChecklist items={goal.items} onToggle={toggle} />
        </>
      )}
      {progress.total === 0 && goal.main ? (
        <>
          <Text style={[styles.label, styles.spaced]}>Что задумывалось</Text>
          <Text style={styles.main}>{goal.main}</Text>
        </>
      ) : null}

      <Text style={[styles.label, styles.spaced]}>Что вышло</Text>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setDirty(true);
        }}
        placeholder={`что на самом деле происходило в ${periodPrepositional(period)}…`}
        placeholderTextColor={colors.textMuted}
        multiline
        style={styles.input}
        accessibilityLabel="Итог месяца"
      />

      <Pressable
        onPress={commitSummary}
        disabled={save.isPending}
        accessibilityRole="button"
        accessibilityLabel="Сохранить итог"
        style={({ pressed }) => [styles.saveBtn, pressed && styles.dimmed]}
      >
        <Text style={styles.saveBtnText}>
          {save.isSuccess && !save.isPending && !dirty ? "Сохранено" : "Сохранить итог"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Заголовок экрана — навигация зовёт его отсюда, чтобы не резать период у себя. */
export const summaryScreenTitle = (period: string): string => `Итог · ${periodTitle(period).toLowerCase()}`;

/** Ключ месяца, тот же самый. Держится рядом, чтобы экраны не считали его по-разному. */
export const summaryMonth = monthKey;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "700" },
  statValueAccent: { color: colors.accentGreen },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 12 },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  spaced: { marginTop: 22 },
  stepsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
  },
  progress: { color: colors.accentGreen, fontSize: 12, marginBottom: 6 },
  main: { color: colors.text, fontSize: 14, lineHeight: 19, marginBottom: 6 },
  input: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 100,
    textAlignVertical: "top",
  },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 14 },
  saveBtnText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  dimmed: { opacity: 0.5 },
});
