import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { confirmDestructive } from "../../lib/confirm";
import { useTodayKey } from "../../lib/useTodayKey";
import { formatDateShort } from "../../lib/date";
import { targets, type Profile } from "../../lib/balance/profile";
import {
  MEALS,
  MEAL_LABELS,
  entriesForDay,
  entriesForMeal,
  remaining,
  sumNutrition,
  type FoodEntry,
  type Meal,
} from "../../lib/balance/food";

/**
 * День: сколько уже съедено из нормы и что именно.
 *
 * Четыре приёма пищи всегда на экране, даже пустые: пустой «ужин» — это вопрос «а что я
 * сегодня ел вечером», а отсутствующий раздел — это ничего.
 */
export default function DiaryScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: object) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ["balanceProfile"],
    queryFn: () => api.getBalanceProfile(),
  });
  const { data: entries = [] } = useQuery<FoodEntry[]>({
    queryKey: ["foodLog", today],
    queryFn: () => api.getFoodLog(today, today),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeFoodEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foodLog"] }),
  });

  const day = entriesForDay(entries, today);
  const eaten = sumNutrition(day);
  const target = profile ? targets(profile) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.date}>{formatDateShort(today)}</Text>

      {target ? (
        <View style={styles.summary}>
          <Text style={styles.big}>{eaten.kcal}</Text>
          <Text style={styles.bigUnit}>
            {`из ${target.calories} ккал · ${
              remaining(target.calories, eaten.kcal) >= 0
                ? `осталось ${remaining(target.calories, eaten.kcal)}`
                : `перебор на ${Math.abs(remaining(target.calories, eaten.kcal))}`
            }`}
          </Text>
          <Bar value={eaten.kcal} target={target.calories} />
          <View style={styles.macros}>
            <MacroBar label="Белки" value={eaten.protein} target={target.proteinG} />
            <MacroBar label="Жиры" value={eaten.fat} target={target.fatG} />
            <MacroBar label="Углеводы" value={eaten.carb} target={target.carbG} />
          </View>
        </View>
      ) : (
        <View style={styles.summary}>
          <Text style={styles.rowHint}>
            Норма ещё не посчитана — заполни профиль на соседней вкладке, и здесь появится,
            сколько осталось на сегодня.
          </Text>
        </View>
      )}

      {MEALS.map((meal) => (
        <MealSection
          key={meal}
          meal={meal}
          entries={entriesForMeal(entries, today, meal)}
          onAdd={() => navigation.navigate("AddFood", { date: today, meal })}
          onRemove={(entry) =>
            confirmDestructive(
              "Убрать из дневника?",
              `«${entry.name}», ${entry.grams} г.`,
              () => remove.mutate(entry.id),
              "Убрать",
            )
          }
        />
      ))}
    </ScrollView>
  );
}

function MealSection({
  meal,
  entries,
  onAdd,
  onRemove,
}: {
  meal: Meal;
  entries: FoodEntry[];
  onAdd: () => void;
  onRemove: (entry: FoodEntry) => void;
}) {
  const total = sumNutrition(entries);
  return (
    <View style={styles.meal}>
      <View style={styles.mealHead}>
        <Text style={styles.mealTitle}>{MEAL_LABELS[meal]}</Text>
        {entries.length > 0 && <Text style={styles.mealTotal}>{total.kcal} ккал</Text>}
      </View>

      {entries.map((e) => (
        <Pressable
          key={e.id}
          onLongPress={() => onRemove(e)}
          accessibilityRole="button"
          accessibilityLabel={`${e.name}, ${e.grams} г, ${e.kcal} ккал. Удерживай, чтобы убрать`}
          style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.entryName} numberOfLines={1}>
              {e.name}
            </Text>
            <Text style={styles.entryDetail}>
              {`${e.grams} г · Б ${e.protein} · Ж ${e.fat} · У ${e.carb}`}
            </Text>
          </View>
          <Text style={styles.entryKcal}>{e.kcal}</Text>
        </Pressable>
      ))}

      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={`Добавить в ${MEAL_LABELS[meal].toLowerCase()}`}
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Feather name="plus" size={15} color={colors.textMuted} />
        <Text style={styles.addText}>Добавить</Text>
      </Pressable>
    </View>
  );
}

/** Полоска «сколько от нормы». Перебор рисуется акцентом, а не красным: это факт, не приговор. */
function Bar({ value, target }: { value: number; target: number }) {
  const share = target > 0 ? Math.min(1, value / target) : 0;
  const over = target > 0 && value > target;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${share * 100}%` }, over && styles.fillOver]} />
    </View>
  );
}

function MacroBar({ label, value, target }: { label: string; value: number; target: number }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>{`${Math.round(value)} / ${target}`}</Text>
      <Bar value={value} target={target} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  date: { color: colors.textMuted, fontSize: 12, marginBottom: 10 },
  summary: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 18,
    alignItems: "center",
  },
  big: { color: colors.accentGreen, fontSize: 40, fontWeight: "700", letterSpacing: -1 },
  bigUnit: { color: colors.textMuted, fontSize: 12, marginBottom: 12 },
  rowHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, alignSelf: "stretch", overflow: "hidden" },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.accentGreen },
  fillOver: { backgroundColor: colors.accent },
  macros: { flexDirection: "row", gap: 12, marginTop: 16, alignSelf: "stretch" },
  macro: { flex: 1, gap: 4 },
  macroLabel: { color: colors.textMuted, fontSize: 11 },
  macroValue: { color: colors.text, fontSize: 12, fontVariant: ["tabular-nums"] },
  meal: { marginBottom: 16 },
  mealHead: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  mealTitle: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
  mealTotal: { color: colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 6,
  },
  pressed: { opacity: 0.75 },
  entryName: { color: colors.text, fontSize: 14 },
  entryDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  entryKcal: { color: colors.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  addText: { color: colors.textMuted, fontSize: 13 },
});
