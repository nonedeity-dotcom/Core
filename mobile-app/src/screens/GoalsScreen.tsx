import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import GoalChecklist from "../components/GoalChecklist";
import {
  emptyGoal,
  findGoal,
  goalProgress,
  monthKey,
  newItem,
  periodTitle,
  renameItem,
  stepItem,
  toggleItem,
  yearCells,
  yearKey,
  type MonthCell,
  type PeriodGoal,
} from "../lib/goals";

/** Первые буквы месяцев — подписи под клетками. «И» трижды, поэтому под ними ещё и номер. */
const MONTH_LETTERS = ["я", "ф", "м", "а", "м", "и", "и", "а", "с", "о", "н", "д"];

/**
 * Год целиком: главная цель года и двенадцать месяцев под ней.
 *
 * Одна дверь вместо трёх. Раньше на «Отчёте» стояли цель месяца, цель года и итог — три
 * строки про одно и то же, и ни одна из них не показывала, как год идёт в целом. Здесь это
 * видно с одного взгляда: закрытые месяцы, идущие, пустые и те, что кончились без итога.
 *
 * Полоска ещё и единственный способ поставить цель на месяц, который не наступил. Раньше
 * открыть можно было только нынешний — октябрь в сентябре завести было негде.
 */
export default function GoalsScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const [year, setYear] = useState(() => yearKey(today));

  const { data: goals = [] } = useQuery<PeriodGoal[]>({ queryKey: ["goals"], queryFn: () => api.getGoals() });
  const stored = findGoal(goals, year);
  const cells = yearCells(goals, year, today);

  const [main, setMain] = useState("");
  const [items, setItems] = useState(stored?.items ?? []);
  const [fresh, setFresh] = useState("");
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === year) return;
    loadedFor.current = year;
    setMain(stored?.main ?? "");
    setItems(stored?.items ?? []);
  }, [year, stored]);

  const save = useMutation({
    mutationFn: (next: PeriodGoal) => api.saveGoal(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });

  const base = (): PeriodGoal => stored ?? emptyGoal(year, today);
  const commit = (next: Partial<Pick<PeriodGoal, "main" | "items">>) => {
    const body = { ...base(), main, items, ...next, updatedAt: today };
    if (next.main !== undefined) setMain(next.main);
    if (next.items !== undefined) setItems(next.items);
    save.mutate(body);
  };

  // Текст сохраняется сам, через секунду после того, как перестал печатать. Кнопки
  // «Сохранить» здесь нет намеренно: она показывала только слово на себе самой, и это
  // читалось как «ничего не произошло».
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (typing.current) clearTimeout(typing.current); }, []);
  const typeMain = (v: string) => {
    setMain(v);
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => save.mutate({ ...base(), main: v, items, updatedAt: today }), 800);
  };

  const addItem = () => {
    const text = fresh.trim();
    if (!text) return;
    setFresh("");
    commit({ items: [...items, newItem(text)] });
  };

  const progress = goalProgress({ ...emptyGoal(year, today), main, items });
  const closed = cells.filter((c) => c.state === "closed").length;
  // Всё, где вообще что-то написано, — иначе «с целями — 0» стояло бы рядом с месяцем,
  // у которого цель есть, просто он кончился без итога.
  const withGoals = cells.filter((c) => c.state !== "empty").length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.yearRow}>
        <Pressable
          onPress={() => setYear(String(Number(year) - 1))}
          accessibilityRole="button"
          accessibilityLabel="Прошлый год"
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <Text style={styles.yearTitle}>{year}</Text>
        <Pressable
          onPress={() => setYear(String(Number(year) + 1))}
          accessibilityRole="button"
          accessibilityLabel="Следующий год"
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Главное на год</Text>
      <TextInput
        value={main}
        onChangeText={typeMain}
        onEndEditing={() => commit({})}
        placeholder="ради чего этот год…"
        placeholderTextColor={colors.textMuted}
        multiline
        style={styles.input}
        accessibilityLabel="Цель на год"
      />

      <View style={styles.stepsHead}>
        <Text style={styles.label}>Крупные куски</Text>
        {progress.total > 0 && (
          <Text style={styles.progress}>
            {progress.done} из {progress.total}
          </Text>
        )}
      </View>
      <GoalChecklist
        items={items}
        onToggle={(id) => commit({ items: toggleItem({ ...base(), items }, id).items })}
        onRename={(id, text) => commit({ items: renameItem({ ...base(), items }, id, text).items })}
        onRemove={(id) => commit({ items: items.filter((i) => i.id !== id) })}
        empty="Год без кусков — это одна строка на двенадцать месяцев. Куски можно и не заводить."
      />
      <View style={styles.addRow}>
        <TextInput
          value={fresh}
          onChangeText={setFresh}
          onSubmitEditing={addItem}
          returnKeyType="done"
          placeholder="ещё кусок…"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.addInput]}
          accessibilityLabel="Новый кусок года"
        />
        <Pressable
          onPress={addItem}
          disabled={!fresh.trim()}
          accessibilityRole="button"
          accessibilityLabel="Добавить кусок"
          style={({ pressed }) => [styles.addBtn, (!fresh.trim() || pressed) && styles.dimmed]}
        >
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      </View>

      {/* Двенадцать клеток — это и карта года, и единственный способ открыть месяц, который
          ещё не наступил или уже прошёл. */}
      <Text style={[styles.label, styles.spaced]}>Месяцы</Text>
      <View style={styles.grid}>
        {cells.map((cell) => (
          <MonthCellView
            key={cell.period}
            cell={cell}
            onPress={() => navigation.navigate("Goal", { period: cell.period })}
          />
        ))}
      </View>
      <Text style={styles.legend}>
        {withGoals > 0
          ? `Что-то написано в ${withGoals} ${plural(withGoals, [
              "месяце",
              "месяцах",
              "месяцах",
            ])}, закрыто итогом — ${closed}. Тёплая клетка значит, что месяц кончился без итога; ` +
            "обведённая — нынешний. Нажми на любой месяц, чтобы открыть его."
          : "Нажми на месяц, чтобы поставить цель — хоть на будущий, хоть задним числом."}
      </Text>
    </ScrollView>
  );
}

function MonthCellView({ cell, onPress }: { cell: MonthCell; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={periodTitle(cell.period)}
      style={({ pressed }) => [
        styles.cell,
        cell.state === "planned" && styles.cellPlanned,
        cell.state === "closed" && styles.cellClosed,
        cell.state === "due" && styles.cellDue,
        cell.current && styles.cellCurrent,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text
        style={[
          styles.cellText,
          cell.state === "closed" && styles.cellTextClosed,
          cell.state === "due" && styles.cellTextDue,
        ]}
      >
        {MONTH_LETTERS[cell.month - 1]}
      </Text>
      <Text style={styles.cellNum}>{cell.total > 0 ? `${cell.done}/${cell.total}` : cell.month}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22, marginBottom: 18 },
  yearTitle: { color: colors.text, fontSize: 20, fontWeight: "700", minWidth: 72, textAlign: "center" },
  arrow: { color: colors.textMuted, fontSize: 24, paddingHorizontal: 6 },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  spaced: { marginTop: 26 },
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
  addBtnText: { color: colors.bg, fontSize: 22, fontWeight: "600", lineHeight: 26 },
  dimmed: { opacity: 0.5 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    width: "22%",
    flexGrow: 1,
    aspectRatio: 1.35,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  cellPlanned: { borderColor: colors.accentGreen },
  cellClosed: { backgroundColor: "rgba(143,184,154,0.22)", borderColor: colors.accentGreen },
  cellDue: { backgroundColor: "rgba(224,138,85,0.16)", borderColor: colors.accent },
  // Нынешний месяц обведён светлым: двойная толщина цветом рамки была неотличима от
  // обычной клетки — то есть её не было вовсе.
  cellCurrent: { borderWidth: 2, borderColor: colors.text },
  cellText: { color: colors.text, fontSize: 15, fontWeight: "700", textTransform: "uppercase" },
  cellTextClosed: { color: colors.accentGreen },
  cellTextDue: { color: colors.accent },
  cellNum: { color: colors.textMuted, fontSize: 9 },
  legend: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 12 },
});

/** Заголовок экрана — навигация зовёт его отсюда. */
export const goalsScreenTitle = (): string => "Цель";

/** Тот же ключ месяца, что у остальных: чтобы экраны не резали дату по-своему. */
export const currentMonth = monthKey;
