import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { confirmDestructive } from "../../lib/confirm";
import { useTodayKey } from "../../lib/useTodayKey";
import { formatDateShort, shiftDate, daysBetween } from "../../lib/date";
import { targets, type Profile } from "../../lib/balance/profile";
import { latestWeight, WEIGHT_LIMITS, type WeightEntry } from "../../lib/balance/weight";
import {
  formatWater,
  waterFor,
  waterTarget,
  GLASS_ML,
  type WaterDay,
} from "../../lib/balance/water";
import {
  MEALS,
  MEAL_LABELS,
  UNIT_SHORT,
  describeEntryAmount,
  entriesForDay,
  entriesForMeal,
  remaining,
  rescaleEntry,
  sumNutrition,
  type FoodEntry,
  type Meal,
} from "../../lib/balance/food";

/**
 * День: сколько уже съедено из нормы и что именно.
 *
 * Четыре приёма пищи всегда на экране, даже пустые: пустой «ужин» — это вопрос «а что я
 * сегодня ел вечером», а отсутствующий раздел — это ничего.
 *
 * День листается назад. Раньше дневник знал только сегодня, и забытый вчерашний ужин было
 * некуда записать — а дневник, в который нельзя дописать вчера, к вечеру третьего дня
 * перестают вести совсем.
 */
export default function DiaryScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: object) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const [date, setDate] = useState<string | null>(null);
  // Показываемый день: null значит «сегодня», и тогда он сам переезжает через полночь.
  const shown = date ?? today;
  const [editing, setEditing] = useState<string | null>(null);

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ["balanceProfile"],
    queryFn: () => api.getBalanceProfile(),
  });
  // Накануне читается вместе с показанным днём — из него работает «как вчера».
  const prevDay = shiftDate(shown, -1);
  const { data: entries = [] } = useQuery<FoodEntry[]>({
    queryKey: ["foodLog", prevDay, shown],
    queryFn: () => api.getFoodLog(prevDay, shown),
  });
  const { data: waterLog = [] } = useQuery<WaterDay[]>({
    queryKey: ["waterLog"],
    queryFn: () => api.getWaterLog(),
  });
  const { data: weightLog = [] } = useQuery<WeightEntry[]>({
    queryKey: ["weightLog"],
    queryFn: () => api.getWeightLog(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["foodLog"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.removeFoodEntry(id),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; grams: number; units: number | null; nutrition: ReturnType<typeof rescaleEntry> }) =>
      api.updateFoodEntry(v.id, {
        grams: v.grams,
        ...(v.units !== null ? { units: v.units } : {}),
        ...v.nutrition,
      }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });
  const copyDay = useMutation({
    mutationFn: async (source: FoodEntry[]) => {
      for (const e of source) {
        const { id: _id, date: _date, ...rest } = e;
        await api.addFoodEntry({ ...rest, date: shown });
      }
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["foodProducts"] });
      qc.invalidateQueries({ queryKey: ["dishes"] });
    },
  });
  const addWater = useMutation({
    mutationFn: (ml: number) => api.addWater(shown, ml),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waterLog"] }),
  });
  const clearWeight = useMutation({
    mutationFn: (day: string) => api.removeWeight(day),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weightLog"] }),
  });
  const setWeight = useMutation({
    mutationFn: (kg: number) => api.setWeight(shown, kg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weightLog"] });
      // Последнее взвешивание — это и есть текущий вес, из которого считаются нормы.
      qc.invalidateQueries({ queryKey: ["balanceProfile"] });
    },
  });

  const day = entriesForDay(entries, shown);
  const eaten = sumNutrition(day);
  const target = profile ? targets(profile) : null;
  const back = daysBetween(shown, today);
  const drunk = waterFor(waterLog, shown);
  const waterGoal = profile ? waterTarget(profile) : 0;
  const weight = weightLog.find((w) => w.date === shown) ?? null;
  const lastKnown = latestWeight(weightLog);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <DayNav
        label={dayLabel(shown, back)}
        onPrev={() => setDate(shiftDate(shown, -1))}
        // Вперёд — только до сегодня: завтрашний обед ещё не съеден, и записывать его нечем.
        onNext={back > 0 ? () => setDate(shiftDate(shown, 1)) : null}
        onToday={back > 0 ? () => setDate(null) : null}
      />

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

      <WaterRow
        ml={drunk}
        target={waterGoal}
        onAdd={(ml) => addWater.mutate(ml)}
      />

      <WeightRow
        weight={weight}
        fallback={lastKnown?.kg ?? profile?.weightKg ?? 70}
        onSet={(kg) => setWeight.mutate(kg)}
        onClear={
          weight
            ? () =>
                confirmDestructive(
                  "Убрать взвешивание?",
                  `Вес за ${formatDateShort(shown)} перестанет учитываться в тренде.`,
                  () => clearWeight.mutate(shown),
                  "Убрать",
                )
            : null
        }
      />

      {MEALS.map((meal) => (
        <MealSection
          key={meal}
          meal={meal}
          entries={entriesForMeal(entries, shown, meal)}
          yesterday={entriesForMeal(entries, prevDay, meal)}
          // При листании назад «вчера» — это день накануне показанного, и подпись это говорит.
          repeatLabel={back === 0 ? "Как вчера" : "Как накануне"}
          editing={editing}
          onEdit={setEditing}
          onSave={(id, grams, units, nutrition) => update.mutate({ id, grams, units, nutrition })}
          onAdd={() => navigation.navigate("AddFood", { date: shown, meal })}
          onRepeat={(from) => copyDay.mutate(from)}
          onRemove={(entry) =>
            confirmDestructive(
              "Убрать из дневника?",
              `«${entry.name}», ${describeEntryAmount(entry)}.`,
              () => remove.mutate(entry.id),
              "Убрать",
            )
          }
        />
      ))}
    </ScrollView>
  );
}

/**
 * Вода за день.
 *
 * Стаканами, а не полем ввода: человек не знает, сколько выпил за день, — он знает, что
 * выпил ещё один. Восемь кружков — это норма, разложенная на понятные части; когда она
 * перекрыта, лишние стаканы считаются числом, а не рисуются девятым и десятым кружком.
 *
 * Считается вся жидкость: чай, кофе, молоко, суп. Об этом сказано прямо под кнопкой, потому
 * что «сколько воды я выпил» и «сколько жидкости я выпил» — вопросы, которые путают чаще
 * всего, и разница между ними — литр в день.
 */
function WaterRow({
  ml,
  target,
  onAdd,
}: {
  ml: number;
  /** Ноль — профиль не заполнен, и нормы нет: тогда счётчик просто считает. */
  target: number;
  onAdd: (ml: number) => void;
}) {
  const glasses = target > 0 ? Math.max(1, Math.round(target / GLASS_ML)) : 8;
  const full = Math.floor(ml / GLASS_ML);
  const done = target > 0 && ml >= target;

  return (
    <View style={styles.waterCard}>
      <View style={styles.waterHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.weightLabel}>Вода</Text>
          <Text style={[styles.waterValue, done && styles.waterDone]}>
            {target > 0 ? `${formatWater(ml)} из ${formatWater(target)}` : formatWater(ml)}
          </Text>
        </View>
        <Pressable
          onPress={() => onAdd(-GLASS_ML)}
          disabled={ml <= 0}
          accessibilityRole="button"
          accessibilityLabel="Убрать стакан"
          style={({ pressed }) => [styles.waterBtn, (pressed || ml <= 0) && styles.pressed]}
        >
          <Text style={styles.waterBtnText}>−</Text>
        </Pressable>
        <Pressable
          onPress={() => onAdd(GLASS_ML)}
          accessibilityRole="button"
          accessibilityLabel="Добавить стакан, 250 мл"
          style={({ pressed }) => [styles.waterBtn, styles.waterBtnMain, pressed && styles.pressed]}
        >
          <Text style={styles.waterBtnMainText}>+</Text>
        </Pressable>
      </View>

      <View style={styles.glasses}>
        {Array.from({ length: glasses }, (_, i) => (
          <View key={i} style={[styles.glass, i < full && styles.glassFull]} />
        ))}
        {full > glasses && <Text style={styles.waterExtra}>{`+${full - glasses}`}</Text>}
      </View>

      <Text style={styles.rowHint}>
        {`Стакан — ${GLASS_ML} мл. Считается вся жидкость: чай, кофе, молоко, суп.`}
      </Text>
    </View>
  );
}

/** Как называется показанный день. Ближние дни — словом: «вчера» читается быстрее даты. */
function dayLabel(date: string, back: number): string {
  if (back === 0) return "Сегодня";
  if (back === 1) return "Вчера";
  if (back === 2) return "Позавчера";
  return formatDateShort(date);
}

function DayNav({
  label,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: (() => void) | null;
  onToday: (() => void) | null;
}) {
  return (
    <View style={styles.dayNav}>
      <Pressable
        onPress={onPrev}
        accessibilityRole="button"
        accessibilityLabel="Предыдущий день"
        hitSlop={10}
        style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
      >
        <Feather name="chevron-left" size={18} color={colors.textMuted} />
      </Pressable>

      <Pressable
        onPress={() => onToday?.()}
        disabled={!onToday}
        accessibilityRole="button"
        accessibilityLabel={onToday ? `${label}. Вернуться на сегодня` : label}
        style={({ pressed }) => [styles.dayLabelWrap, pressed && onToday && styles.pressed]}
      >
        <Text style={styles.dayLabel}>{label}</Text>
        {onToday && <Text style={styles.dayBack}>вернуться на сегодня</Text>}
      </Pressable>

      <Pressable
        onPress={() => onNext?.()}
        disabled={!onNext}
        accessibilityRole="button"
        accessibilityLabel="Следующий день"
        hitSlop={10}
        style={({ pressed }) => [styles.navBtn, !onNext && styles.navBtnOff, pressed && styles.pressed]}
      >
        <Feather name="chevron-right" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

/**
 * Вес за этот день.
 *
 * Стоит в дневнике, а не только в профиле, потому что взвешиваются утром и там же, где
 * потом записывают завтрак. Шаг 100 граммов: вес меняется на сотни грамм, а не на
 * килограммы, и стрелка на килограмм заставляла бы промахиваться каждый раз.
 */
function WeightRow({
  weight,
  fallback,
  onSet,
  onClear,
}: {
  weight: WeightEntry | null;
  fallback: number;
  onSet: (kg: number) => void;
  onClear: (() => void) | null;
}) {
  const value = weight?.kg ?? fallback;
  const step = (d: number) => {
    const next = Math.round((value + d) * 10) / 10;
    if (next < WEIGHT_LIMITS.min || next > WEIGHT_LIMITS.max) return;
    onSet(next);
  };

  if (!weight) {
    return (
      <Pressable
        onPress={() => onSet(fallback)}
        accessibilityRole="button"
        accessibilityLabel="Записать вес за этот день"
        style={({ pressed }) => [styles.weightEmpty, pressed && styles.pressed]}
      >
        <Feather name="trending-down" size={15} color={colors.textMuted} />
        <Text style={styles.addText}>{`Записать вес — ${fallback.toFixed(1)} кг`}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.weightRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.weightLabel}>Вес</Text>
        <Text style={styles.weightValue}>{`${weight.kg.toFixed(1)} кг`}</Text>
      </View>
      <Pressable
        onPress={() => step(-0.1)}
        accessibilityRole="button"
        accessibilityLabel="Меньше: вес"
        style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
      >
        <Text style={styles.miniBtnText}>−</Text>
      </Pressable>
      <Pressable
        onPress={() => step(0.1)}
        accessibilityRole="button"
        accessibilityLabel="Больше: вес"
        style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
      >
        <Text style={styles.miniBtnText}>+</Text>
      </Pressable>
      {onClear && (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Убрать взвешивание"
          style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
        >
          <Feather name="x" size={13} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function MealSection({
  meal,
  entries,
  yesterday,
  repeatLabel,
  editing,
  onEdit,
  onSave,
  onAdd,
  onRepeat,
  onRemove,
}: {
  meal: Meal;
  entries: FoodEntry[];
  yesterday: FoodEntry[];
  repeatLabel: string;
  editing: string | null;
  onEdit: (id: string | null) => void;
  onSave: (id: string, grams: number, units: number | null, nutrition: ReturnType<typeof rescaleEntry>) => void;
  onAdd: () => void;
  onRepeat: (entries: FoodEntry[]) => void;
  onRemove: (entry: FoodEntry) => void;
}) {
  const total = sumNutrition(entries);
  return (
    <View style={styles.meal}>
      {/* Само название и есть кнопка «добавить».
          Отдельная строка «+ Добавить» под каждым приёмом занимала четыре строки экрана и
          повторяла то, на что человек и так нажимает: в приём еду и добавляют, других
          действий у него нет. Нажимается вся шапка целиком, вместе с числом калорий, —
          так цель шире и попасть в неё проще, чем в одно слово. */}
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={`Добавить в ${MEAL_LABELS[meal].toLowerCase()}`}
        style={({ pressed }) => [styles.mealHead, pressed && styles.pressed]}
      >
        <Text style={styles.mealTitle}>{MEAL_LABELS[meal]}</Text>
        {entries.length > 0 && <Text style={styles.mealTotal}>{total.kcal} ккал</Text>}
      </Pressable>

      {entries.map((e) =>
        editing === e.id ? (
          <AmountEdit key={e.id} entry={e} onCancel={() => onEdit(null)} onSave={onSave} />
        ) : (
          <Pressable
            key={e.id}
            onPress={() => onEdit(e.id)}
            onLongPress={() => onRemove(e)}
            accessibilityRole="button"
            accessibilityLabel={`${e.name}, ${describeEntryAmount(e)}, ${e.kcal} ккал. Нажми, чтобы поправить количество; удерживай, чтобы убрать`}
            style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.entryName} numberOfLines={1}>
                {e.name}
              </Text>
              <Text style={styles.entryDetail}>
                {`${describeEntryAmount(e)} · Б ${e.protein} · Ж ${e.fat} · У ${e.carb}`}
              </Text>
            </View>
            <Text style={styles.entryKcal}>{e.kcal}</Text>
          </Pressable>
        ),
      )}

      {/* Завтрак у большинства людей один и тот же. Появляется, только когда вчера в этом
          приёме что-то было и сегодня в нём ещё пусто: иначе это кнопка «удвоить обед». */}
      {entries.length === 0 && yesterday.length > 0 && (
        <Pressable
          onPress={() => onRepeat(yesterday)}
          accessibilityRole="button"
          accessibilityLabel={`${repeatLabel}: ${MEAL_LABELS[meal].toLowerCase()}, ${yesterday.length} ${plural(
            yesterday.length,
            ["запись", "записи", "записей"],
          )}`}
          style={({ pressed }) => [styles.addRow, styles.repeatRow, pressed && styles.pressed]}
        >
          <Feather name="rotate-ccw" size={14} color={colors.textMuted} />
          <Text style={styles.addText}>
            {`${repeatLabel} · ${sumNutrition(yesterday).kcal} ккал`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Правка веса уже записанного.
 *
 * Пересчитывается из самой записи, а не из продукта: продукт мог с тех пор измениться или
 * исчезнуть, а «съел не 200 г, а 150» — это уточнение того же самого, а не новая еда.
 */
function AmountEdit({
  entry,
  onCancel,
  onSave,
}: {
  entry: FoodEntry;
  onCancel: () => void;
  onSave: (id: string, grams: number, units: number | null, nutrition: ReturnType<typeof rescaleEntry>) => void;
}) {
  const [grams, setGrams] = useState(entry.grams);
  const nutrition = rescaleEntry(entry, grams);
  // Сколько граммов в одной единице — из самой записи: она помнит и граммы, и штуки.
  const perUnit = entry.units && entry.units > 0 ? entry.grams / entry.units : 0;
  const stepBy = perUnit > 0 ? perUnit : 10;
  const units = perUnit > 0 ? Math.round((grams / perUnit) * 100) / 100 : null;
  // Шаг в родных единицах: у яиц стрелка должна двигать на яйцо, а не на десять граммов.
  const step = (d: number) => setGrams((g) => Math.max(1, Math.round(g + d * stepBy)));

  return (
    <View style={styles.editCard}>
      <Text style={styles.entryName} numberOfLines={1}>
        {entry.name}
      </Text>
      <View style={styles.editRow}>
        <Pressable
          onPress={() => step(-1)}
          accessibilityRole="button"
          accessibilityLabel="Меньше"
          style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
        >
          <Text style={styles.miniBtnText}>−</Text>
        </Pressable>
        <View style={styles.editValue}>
          <Text style={styles.editGrams}>
            {units !== null && entry.unit ? `${units} ${UNIT_SHORT[entry.unit]}` : `${grams} г`}
          </Text>
          <Text style={styles.entryDetail}>
            {units !== null ? `${grams} г · ` : ""}
            {`${nutrition.kcal} ккал · Б ${nutrition.protein} · Ж ${nutrition.fat} · У ${nutrition.carb}`}
          </Text>
        </View>
        <Pressable
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel="Больше"
          style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
        >
          <Text style={styles.miniBtnText}>+</Text>
        </Pressable>
      </View>
      <View style={styles.editActions}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          style={({ pressed }) => [styles.editCancel, pressed && styles.pressed]}
        >
          <Text style={styles.addText}>Отмена</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(entry.id, grams, units, nutrition)}
          accessibilityRole="button"
          accessibilityLabel="Сохранить количество"
          style={({ pressed }) => [styles.editSave, pressed && styles.pressed]}
        >
          <Text style={styles.editSaveText}>Сохранить</Text>
        </Pressable>
      </View>
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
  dayNav: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  navBtnOff: { opacity: 0.3 },
  dayLabelWrap: { flex: 1, alignItems: "center" },
  dayLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  dayBack: { color: colors.textMuted, fontSize: 10, marginTop: 1 },
  summary: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
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
  waterCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 10,
  },
  waterHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  waterValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  waterDone: { color: colors.accentGreen },
  waterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  waterBtnText: { color: colors.text, fontSize: 20, fontWeight: "600" },
  waterBtnMain: { backgroundColor: "rgba(143,184,154,0.14)" },
  waterBtnMainText: { color: colors.accentGreen, fontSize: 20, fontWeight: "600" },
  glasses: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  glass: {
    width: 18,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  glassFull: { backgroundColor: colors.accentGreenDark, borderColor: colors.accentGreen },
  waterExtra: { color: colors.accentGreen, fontSize: 12, fontWeight: "600", marginLeft: 2 },
  weightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 18,
  },
  weightEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 18,
  },
  weightLabel: { color: colors.textMuted, fontSize: 11 },
  weightValue: { color: colors.text, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meal: { marginBottom: 16 },
  // Шапка приёма — теперь кнопка, и у неё должна быть высота, в которую попадает палец.
  // Одна строка текста в четырнадцать пунктов такой высотой не является.
  mealHead: { flexDirection: "row", alignItems: "center", paddingVertical: 8, marginBottom: 2 },
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
  editCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  editRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  editValue: { flex: 1, alignItems: "center" },
  editGrams: { color: colors.text, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  editActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  editCancel: { flex: 1, alignItems: "center", paddingVertical: 9 },
  editSave: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.accentGreenDark,
  },
  editSaveText: { color: colors.bg, fontSize: 13, fontWeight: "600" },
  miniBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBorder,
  },
  miniBtnText: { color: colors.text, fontSize: 16, lineHeight: 18 },
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
  repeatRow: { marginTop: 6 },
  addText: { color: colors.textMuted, fontSize: 13 },
});
