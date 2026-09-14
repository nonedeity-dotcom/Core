import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import GoalChecklist from "../components/GoalChecklist";
import {
  carryItems,
  emptyGoal,
  findGoal,
  goalProgress,
  hasContent,
  kindOf,
  monthKey,
  newItem,
  periodAccusative,
  periodGenitive,
  periodTitle,
  prevMonth,
  type GoalItem,
  type PeriodGoal,
} from "../lib/goals";

/**
 * Цель на месяц или на год: одна главная строка и список мелких пунктов.
 *
 * Здесь принципиально нет ни одного числа, которое приложение считает само. Закрытые дни,
 * серия, часы фокуса — всё это уже есть в «Статистике», и там оно честнее, чем любая
 * попытка вывести из него цель. А то, ради чего всё это вообще делается, знает только
 * человек, и записать это может только он.
 *
 * Экран один на месяц и на год: разница между ними — в ключе периода и в словах вокруг.
 * Заводить два одинаковых экрана ради этого значило бы чинить потом оба.
 */
export default function GoalScreen({
  route,
  navigation,
}: {
  route: { params: { period: string } };
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const period = route.params.period;
  const kind = kindOf(period);

  const { data: goals = [] } = useQuery<PeriodGoal[]>({
    queryKey: ["goals"],
    queryFn: () => api.getGoals(),
  });

  const stored = findGoal(goals, period);
  const [main, setMain] = useState("");
  const [items, setItems] = useState<GoalItem[]>([]);
  const [fresh, setFresh] = useState("");
  // «Сохранено» держится только до следующей правки. Иначе кнопка успокаивает ровно в тот
  // момент, когда текст на экране уже не тот, что в хранилище.
  const [dirty, setDirty] = useState(false);
  // Заполняется один раз на период, а не на каждую перерисовку: список обновляется после
  // каждого сохранения, и повторное заполнение стирало бы то, что сейчас печатают.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === period) return;
    loadedFor.current = period;
    if (stored) {
      setMain(stored.main);
      setItems(stored.items);
    }
  }, [period, stored]);

  const save = useMutation({
    mutationFn: (next: { main: string; items: GoalItem[] }) =>
      api.saveGoal({
        ...(stored ?? emptyGoal(period, today)),
        main: next.main,
        items: next.items,
        updatedAt: today,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });

  // Всё, что видно на экране, и уходит в хранилище — одним куском. Иначе галочка,
  // поставленная до нажатия «Сохранить», уносила бы с собой старый текст.
  const commit = (next: Partial<{ main: string; items: GoalItem[] }> = {}) => {
    const body = { main, items, ...next };
    if (next.main !== undefined) setMain(next.main);
    if (next.items !== undefined) setItems(next.items);
    setDirty(false);
    save.mutate(body);
  };

  const addItem = () => {
    const text = fresh.trim();
    if (!text) return;
    setFresh("");
    commit({ items: [...items, newItem(text)] });
  };

  // Перенос предлагается только в пустой список: дописывать невыполненное в уже начатый
  // месяц — это удвоение пунктов, а не помощь.
  const carried = kind === "month" && items.length === 0 ? carryItems(findGoal(goals, prevMonth(period))) : [];

  const past = goals
    .filter((g) => g.kind === kind && g.period !== period && hasContent(g))
    .slice(0, 12);

  const progress = goalProgress({ ...emptyGoal(period, today), main, items });
  // Итог этого месяца, если он уже написан: в «Отчёте» строка к тому времени исчезает —
  // она зовёт писать, а не перечитывать, — и дописать написанное было бы негде.
  const ownSummary = kind === "month" && stored?.summary ? stored.summary : "";

  // История открывается там же, где пишется: месяц — на итоге, год — на своей же цели.
  const openPast = (p: string) =>
    kindOf(p) === "month" ? navigation.navigate("MonthSummary", { period: p }) : navigation.navigate("Goal", { period: p });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        {kind === "month"
          ? "Одна главная цель на месяц и несколько шагов к ней. Шаги отмечаешь сам — приложение не знает, сделал ты их или нет, и не делает вид, что знает."
          : "Главное на год — одной строкой, чтобы его было видно каждый месяц. Крупные куски — списком ниже; менять их можно в любой момент."}
      </Text>

      <Text style={styles.label}>Главное</Text>
      <TextInput
        value={main}
        onChangeText={(v) => {
          setMain(v);
          setDirty(true);
        }}
        onEndEditing={() => commit()}
        placeholder={kind === "month" ? `что должно случиться за ${periodAccusative(period)}…` : "ради чего этот год…"}
        placeholderTextColor={colors.textMuted}
        multiline
        style={styles.input}
        accessibilityLabel="Главная цель"
      />

      <View style={styles.stepsHead}>
        <Text style={styles.label}>Шаги</Text>
        {progress.total > 0 && (
          <Text style={styles.progress}>
            {progress.done} из {progress.total}
          </Text>
        )}
      </View>

      <GoalChecklist
        items={items}
        onToggle={(id) => commit({ items: items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) })}
        onRemove={(id) => commit({ items: items.filter((i) => i.id !== id) })}
        empty="Пока пусто. Шаг — это то, про что в конце периода можно ответить «да» или «нет»."
      />

      <View style={styles.addRow}>
        <TextInput
          value={fresh}
          onChangeText={setFresh}
          onSubmitEditing={addItem}
          returnKeyType="done"
          placeholder="ещё шаг…"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.addInput]}
          accessibilityLabel="Новый шаг"
        />
        <Pressable
          onPress={addItem}
          disabled={!fresh.trim()}
          accessibilityRole="button"
          accessibilityLabel="Добавить шаг"
          style={({ pressed }) => [styles.addBtn, (!fresh.trim() || pressed) && styles.dimmed]}
        >
          <Feather name="plus" size={18} color={colors.bg} />
        </Pressable>
      </View>

      {carried.length > 0 && (
        <Pressable
          onPress={() => commit({ items: carried })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.carryRow, pressed && { opacity: 0.7 }]}
        >
          <Feather name="corner-down-right" size={15} color={colors.textMuted} />
          <Text style={styles.carryText}>
            {`Перенести ${carried.length} ${plural(carried.length, [
              "невыполненный шаг",
              "невыполненных шага",
              "невыполненных шагов",
            ])} из ${periodGenitive(prevMonth(period))}`}
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={() => commit()}
        disabled={save.isPending}
        accessibilityRole="button"
        accessibilityLabel="Сохранить цель"
        style={({ pressed }) => [styles.saveBtn, pressed && styles.dimmed]}
      >
        <Text style={styles.saveBtnText}>
          {save.isSuccess && !save.isPending && !dirty ? "Сохранено" : "Сохранить"}
        </Text>
      </Pressable>

      {ownSummary ? (
        <Pressable
          onPress={() => navigation.navigate("MonthSummary", { period })}
          accessibilityRole="button"
          accessibilityLabel="Итог за этот месяц"
          style={({ pressed }) => [styles.summaryRow, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryLabel}>Итог записан</Text>
            <Text style={styles.summaryText} numberOfLines={2}>
              {ownSummary}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      {past.length > 0 && (
        <>
          <Text style={styles.historyLabel}>{kind === "month" ? "Прошлые месяцы" : "Прошлые годы"}</Text>
          {past.map((g) => {
            const p = goalProgress(g);
            return (
              <Pressable
                key={g.period}
                onPress={() => openPast(g.period)}
                accessibilityRole="button"
                accessibilityLabel={periodTitle(g.period)}
                style={({ pressed }) => [styles.historyCard, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.historyPeriod}>
                  {periodTitle(g.period)}
                  {p.total > 0 ? ` · ${p.done} из ${p.total}` : ""}
                </Text>
                {g.main ? <Text style={styles.historyMain}>{g.main}</Text> : null}
                {g.summary ? <Text style={styles.historySummary}>{g.summary}</Text> : null}
              </Pressable>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

/** Заголовок экрана: его же ставит навигация, и считать период она умеет только отсюда. */
export const goalScreenTitle = (period: string): string =>
  kindOf(period) === "month" ? `Цель · ${periodTitle(period).toLowerCase()}` : `Цель на ${period}`;

/** Ключ месяца для «цели на этот месяц» — чтобы экраны не резали дату по-своему. */
export const currentMonth = monthKey;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 18 },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  input: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 50,
    textAlignVertical: "top",
  },
  stepsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 },
  progress: { color: colors.accentGreen, fontSize: 12, marginBottom: 6 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  addInput: { flex: 1, minHeight: 46, paddingVertical: 12 },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  carryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  carryText: { color: colors.textMuted, fontSize: 12, flex: 1, lineHeight: 17 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 18 },
  saveBtnText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  dimmed: { opacity: 0.5 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 12,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 3 },
  summaryText: { color: colors.accentGreen, fontSize: 13, lineHeight: 18 },
  chevron: { color: colors.textMuted, fontSize: 20 },
  historyLabel: { color: colors.textMuted, fontSize: 12, marginTop: 28, marginBottom: 10 },
  historyCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 6,
  },
  historyPeriod: { color: colors.textMuted, fontSize: 11 },
  historyMain: { color: colors.text, fontSize: 13, lineHeight: 18 },
  historySummary: { color: colors.accentGreen, fontSize: 13, lineHeight: 18 },
});
