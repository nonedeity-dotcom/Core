import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { todayKey } from "../../lib/date";
import { plural } from "../../lib/plural";
import {
  ACTIVITY_FACTORS,
  ACTIVITY_HINTS,
  ACTIVITY_LABELS,
  DEFAULT_PROFILE,
  GOAL_LABELS,
  GOAL_SHIFT,
  LIMITS,
  bmr,
  normalizeProfile,
  targets,
  tdee,
  type Activity,
  type Goal,
  type Profile,
  type Sex,
} from "../../lib/balance/profile";

/**
 * Профиль и нормы: то, из чего CaloriX вообще считает.
 *
 * Числа шагаются кнопками, а не набираются в поле. Клавиатура здесь была бы честнее по
 * количеству нажатий, но рост и возраст вводятся один раз и потом не трогаются, а вес —
 * единственное, что меняется, и он меняется на сотни грамм, а не на десятки килограмм.
 *
 * Нормы показываются тут же и пересчитываются на каждое нажатие: настройка, результат
 * которой надо идти проверять на другой экран, — это настройка вслепую.
 */
export default function BalanceProfileScreen() {
  const qc = useQueryClient();
  const { data: stored, isSuccess } = useQuery<Profile | null>({
    queryKey: ["balanceProfile"],
    queryFn: () => api.getBalanceProfile(),
  });

  // Черновик: экран правится непрерывно, и писать в хранилище на каждое нажатие «+» значит
  // сто записей на одну настройку веса.
  const [draft, setDraft] = useState<Profile>(DEFAULT_PROFILE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSuccess || ready) return;
    if (stored) setDraft(stored);
    setReady(true);
  }, [isSuccess, stored, ready]);

  const save = useMutation({
    mutationFn: (p: Profile) => api.setBalanceProfile(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["balanceProfile"] }),
  });

  const patch = (next: Partial<Profile>) => {
    const merged = normalizeProfile({ ...draft, ...next }) ?? draft;
    setDraft(merged);
    save.mutate(merged);
  };

  const logWeight = useMutation({
    mutationFn: (kg: number) => api.setWeight(todayKey(), kg),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weightLog"] }),
  });

  const setWeight = (kg: number) => {
    patch({ weightKg: kg });
    logWeight.mutate(kg);
  };

  const t = targets(draft);
  const filled = stored !== null && stored !== undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      {/* Числа ниже — не профиль, а пример, пока их не подтвердили. Экран показывал полную
          норму, а дневник в это же время писал «норма ещё не посчитана»: два экрана
          отвечали на один вопрос по-разному, потому что нетронутый профиль никуда не
          записывался. Теперь об этом сказано прямо, и есть чем согласиться. */}
      {!filled && (
        <View style={styles.introCard}>
          <Text style={styles.intro}>
            Это пример, а не твои данные: пока ничего не записано, и дневник норму не
            показывает. Поправь числа под себя — или согласись с этими, если они верные.
          </Text>
          <Pressable
            onPress={() => patch({})}
            accessibilityRole="button"
            accessibilityLabel="Сохранить профиль"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Всё верно, считай норму</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.sectionLabel}>Норма на день</Text>
      <View style={styles.targetCard}>
        <Text style={styles.calories}>{t.calories}</Text>
        <Text style={styles.caloriesUnit}>ккал</Text>
        <View style={styles.macros}>
          <Macro label="Белки" value={t.proteinG} />
          <Macro label="Жиры" value={t.fatG} />
          <Macro label="Углеводы" value={t.carbG} />
        </View>
        {/* Читалось как «расход 2635 × 1.55», хотя коэффициент в расходе уже учтён: строка
            показывала умножение, которого не происходит. Теперь это разбор по шагам. */}
        <Text style={styles.formula}>
          {`Базовый обмен ${bmr(draft)} × ${ACTIVITY_FACTORS[draft.activity]} = расход ${tdee(draft)} ккал`}
        </Text>
        <Text style={styles.formula}>
          {`Цель «${GOAL_LABELS[draft.goal].toLowerCase()}»: ${
            GOAL_SHIFT[draft.goal] === 0
              ? "норма равна расходу"
              : `${GOAL_SHIFT[draft.goal] > 0 ? "+" : "−"}${Math.abs(GOAL_SHIFT[draft.goal])} ккал`
          }`}
        </Text>
        {/* Формула выведена на выборке, а не на вас: приложение не притворяется, что знает
            ваш обмен веществ с точностью до килокалории. */}
        <Text style={styles.caveat}>
          Это оценка по формуле Миффлина — Сан Жеора. Попадание ±10 % считается хорошим
          результатом, так что число — точка отсчёта, а не приговор: если вес не двигается
          две недели, двигать надо его, а не веру в формулу.
        </Text>
      </View>

      <Text style={[styles.sectionLabel, styles.spaced]}>О себе</Text>
      <View style={styles.card}>
        <Text style={styles.rowLabel}>Пол</Text>
        <View style={styles.chipRow}>
          {(["male", "female"] as Sex[]).map((sex) => (
            <Chip key={sex} on={draft.sex === sex} onPress={() => patch({ sex })}>
              {sex === "male" ? "Мужской" : "Женский"}
            </Chip>
          ))}
        </View>
      </View>

      <Stepper
        label="Возраст"
        value={`${draft.age}`}
        unit={plural(draft.age, ["год", "года", "лет"])}
        onStep={(d) => patch({ age: draft.age + d })}
        min={draft.age <= LIMITS.age.min}
        max={draft.age >= LIMITS.age.max}
      />
      <Stepper
        label="Рост"
        value={`${draft.heightCm}`}
        unit="см"
        onStep={(d) => patch({ heightCm: draft.heightCm + d })}
        min={draft.heightCm <= LIMITS.heightCm.min}
        max={draft.heightCm >= LIMITS.heightCm.max}
      />
      {/* Вес — единственное, что здесь меняется регулярно, поэтому он же и записывается в
          дневник веса: иначе тренд на «Статистике» не знал бы о правках из профиля, а
          профиль — о взвешиваниях из дневника. */}
      <Stepper
        label="Вес"
        value={draft.weightKg.toFixed(1)}
        unit="кг"
        step={0.5}
        onStep={(d) => setWeight(Math.round((draft.weightKg + d) * 10) / 10)}
        min={draft.weightKg <= LIMITS.weightKg.min}
        max={draft.weightKg >= LIMITS.weightKg.max}
      />

      <Text style={[styles.sectionLabel, styles.spaced]}>Активность</Text>
      <View style={styles.card}>
        <View style={styles.chipRow}>
          {(Object.keys(ACTIVITY_FACTORS) as Activity[]).map((a) => (
            <Chip key={a} on={draft.activity === a} onPress={() => patch({ activity: a })}>
              {ACTIVITY_LABELS[a]}
            </Chip>
          ))}
        </View>
        <Text style={styles.rowHint}>
          {`${ACTIVITY_LABELS[draft.activity]} — ${ACTIVITY_HINTS[draft.activity]}. Коэффициент ${
            ACTIVITY_FACTORS[draft.activity]
          }.`}
        </Text>
      </View>

      <Text style={[styles.sectionLabel, styles.spaced]}>Цель</Text>
      <View style={styles.card}>
        <View style={styles.chipRow}>
          {(["lose", "keep", "gain"] as Goal[]).map((g) => (
            <Chip key={g} on={draft.goal === g} onPress={() => patch({ goal: g })}>
              {GOAL_LABELS[g]}
            </Chip>
          ))}
        </View>
        <Text style={styles.rowHint}>
          {draft.goal === "keep"
            ? "Норма равна расходу."
            : draft.goal === "gain"
              ? "К расходу прибавляется 400 ккал."
              : "От расхода отнимается 400 ккал."}
        </Text>
      </View>
    </ScrollView>
  );
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label}, г</Text>
    </View>
  );
}

function Chip({ on, onPress, children }: { on: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{children}</Text>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  unit,
  step = 1,
  onStep,
  min,
  max,
}: {
  label: string;
  value: string;
  unit: string;
  step?: number;
  onStep: (delta: number) => void;
  min: boolean;
  max: boolean;
}) {
  return (
    <View style={styles.stepperCard}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onStep(-step)}
          disabled={min}
          accessibilityRole="button"
          accessibilityLabel={`Меньше: ${label}`}
          style={({ pressed }) => [styles.stepBtn, min && styles.stepBtnOff, pressed && styles.pressed]}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>
          {value} <Text style={styles.stepUnit}>{unit}</Text>
        </Text>
        <Pressable
          onPress={() => onStep(step)}
          disabled={max}
          accessibilityRole="button"
          accessibilityLabel={`Больше: ${label}`}
          style={({ pressed }) => [styles.stepBtn, max && styles.stepBtnOff, pressed && styles.pressed]}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  introCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 18,
  },
  primary: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.accentGreenDark,
  },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 18 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 10,
  },
  targetCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: "center",
    gap: 4,
  },
  calories: { color: colors.accentGreen, fontSize: 44, fontWeight: "700", letterSpacing: -1 },
  caloriesUnit: { color: colors.textMuted, fontSize: 12 },
  macros: { flexDirection: "row", gap: 24, marginTop: 12 },
  macro: { alignItems: "center" },
  macroValue: { color: colors.text, fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] },
  macroLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  formula: { color: colors.textMuted, fontSize: 11, marginTop: 12, textAlign: "center", lineHeight: 16 },
  caveat: {
    color: colors.accent,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    alignSelf: "stretch",
  },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  pressed: { opacity: 0.75 },
  stepperCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12, marginLeft: "auto" },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnOff: { opacity: 0.35 },
  stepBtnText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  stepValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 78,
    textAlign: "center",
  },
  stepUnit: { color: colors.textMuted, fontSize: 12, fontWeight: "400" },
});
