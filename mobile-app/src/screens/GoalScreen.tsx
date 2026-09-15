import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
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
  MAX_ITEM_TARGET,
  carryItems,
  emptyGoal,
  findGoal,
  goalProgress,
  hasContent,
  monthRange,
  newItem,
  periodAccusative,
  periodPrepositional,
  periodTitle,
  prevMonth,
  renameItem,
  repeatItems,
  stepItem,
  toggleItem,
  type GoalItem,
  type PeriodGoal,
} from "../lib/goals";
import type { Habit, HabitLog } from "../types";

/**
 * Один месяц целиком: цель, шаги и итог в конце.
 *
 * Итог живёт здесь, а не на отдельном экране, потому что это один разговор: что задумывал,
 * что из этого отмечено, что вышло на самом деле. Разложенный по двум экранам, он заставлял
 * ходить туда-сюда ровно в тот момент, когда его и так пишут через силу.
 *
 * Кнопки «Сохранить» нет. Всё сохраняется само — текст через секунду после того, как
 * перестал печатать, отметки сразу, — а кнопка внизу закрывает экран. Прежняя кнопка
 * сохраняла честно, но единственным признаком этого было слово на ней самой, и читалось
 * это как «ничего не произошло».
 */
export default function GoalScreen({
  route,
  navigation,
}: {
  route: { params: { period: string } };
  navigation: { goBack: () => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const period = route.params.period;
  const range = monthRange(period);
  const over = range.to < today;
  const started = range.from <= today;

  const { data: goals = [] } = useQuery<PeriodGoal[]>({ queryKey: ["goals"], queryFn: () => api.getGoals() });
  const stored = findGoal(goals, period);

  const [main, setMain] = useState("");
  const [items, setItems] = useState<GoalItem[]>([]);
  const [summary, setSummary] = useState("");
  const [fresh, setFresh] = useState("");
  const [freshTarget, setFreshTarget] = useState("");
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === period) return;
    loadedFor.current = period;
    setMain(stored?.main ?? "");
    setItems(stored?.items ?? []);
    setSummary(stored?.summary ?? "");
  }, [period, stored]);

  const save = useMutation({
    mutationFn: (next: PeriodGoal) => api.saveGoal(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });

  // Подставленные цифры — это заготовка, а не итог. Если человек ничего к ним не дописал,
  // месяц остаётся незакрытым: иначе одно открытие экрана в конце месяца само себе засчитало
  // бы итог, которого никто не писал, и клетка в году позеленела бы ни за что.
  const prefill = useRef("");

  const base = (): PeriodGoal => stored ?? emptyGoal(period, today);
  const build = (next: Partial<Pick<PeriodGoal, "main" | "items" | "summary">>): PeriodGoal => {
    const body = { ...base(), main, items, summary, ...next, updatedAt: today };
    const typed = body.summary.trim();
    const text = typed === prefill.current.trim() ? "" : typed;
    // Дата итога — то, по чему его отличают от «ещё не написан». Стирается вместе с текстом:
    // пустой итог с датой выглядел бы написанным и больше не просился бы.
    return { ...body, summary: text, summaryDate: text ? today : "" };
  };
  const commit = (next: Partial<Pick<PeriodGoal, "main" | "items" | "summary">> = {}) => {
    if (next.main !== undefined) setMain(next.main);
    if (next.items !== undefined) setItems(next.items);
    if (next.summary !== undefined) setSummary(next.summary);
    save.mutate(build(next));
  };

  // Автосохранение текста: через секунду после того, как перестал печатать. Оба поля через
  // один таймер — печатают всё равно в одно за раз.
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (typing.current) clearTimeout(typing.current); }, []);
  const typeLater = (next: Partial<Pick<PeriodGoal, "main" | "summary">>) => {
    if (next.main !== undefined) setMain(next.main);
    if (next.summary !== undefined) setSummary(next.summary);
    if (typing.current) clearTimeout(typing.current);
    const snapshot = { main, summary, ...next };
    typing.current = setTimeout(() => save.mutate(build(snapshot)), 800);
  };

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const factTo = over ? range.to : today;
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "month", range.from, factTo],
    queryFn: () => api.getHabitLog(range.from, factTo) as Promise<HabitLog[]>,
    enabled: started,
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

  const facts = started
    ? monthFacts(countedDates(habits, logs, dayRule, levelRule), freezes, range.from, factTo, daysOff)
    : null;

  /** Цифры месяца одной фразой — с неё начинается итог, чтобы он не начинался с пустого листа. */
  const factLine = facts
    ? `Закрыто ${facts.closed} ${plural(facts.closed, ["день", "дня", "дней"])} из ${facts.days}` +
      `, лучшая серия ${facts.best}` +
      (facts.skips > 0 ? `, ${facts.skips} ${plural(facts.skips, ["шанс", "шанса", "шансов"])}` : "") +
      (facts.off > 0 ? `, ${facts.off} ${plural(facts.off, ["выходной", "выходных", "выходных"])}` : "") +
      "."
    : "";

  // Заготовка: в конце месяца пустое поле итога заполняется цифрами — дальше дописываешь
  // словами. Пустой лист в последний день месяца — главная причина, по которой итог не
  // пишут вовсе. Подставляется один раз и только в пустое: написанное не трогается.
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (prefilled.current === period) return;
    if (!over || !factLine || (stored?.summary ?? "").trim() !== "" || summary.trim() !== "") return;
    prefilled.current = period;
    prefill.current = `${factLine} `;
    setSummary(prefill.current);
  }, [period, over, factLine, stored, summary]);

  const previous = findGoal(goals, prevMonth(period));
  const carried = items.length === 0 ? carryItems(previous) : [];
  const repeatable = items.length === 0 && hasContent(previous) ? repeatItems(previous) : [];

  const addItem = () => {
    const text = fresh.trim();
    if (!text) return;
    const n = Number(freshTarget.replace(",", "."));
    const target = Number.isFinite(n) && n > 1 ? Math.min(MAX_ITEM_TARGET, Math.round(n)) : undefined;
    setFresh("");
    setFreshTarget("");
    commit({ items: [...items, newItem(text, target)] });
  };

  const progress = goalProgress({ ...emptyGoal(period, today), main, items });
  const left = Math.max(0, Number(range.to.slice(8, 10)) - Number(today.slice(8, 10)));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Название месяца стоит в шапке навигации — повторять его заголовком значило бы
          написать одно и то же дважды подряд. Здесь только то, чего в шапке нет: сколько
          времени у этого месяца осталось. */}
      <Text style={styles.when}>
        {over
          ? "Месяц закончился"
          : !started
            ? "Месяц ещё не начался"
            : left === 0
              ? "Последний день месяца"
              : `Осталось ${left} ${plural(left, ["день", "дня", "дней"])}`}
      </Text>

      <Text style={styles.label}>Главное</Text>
      <TextInput
        value={main}
        onChangeText={(v) => typeLater({ main: v })}
        onEndEditing={() => commit()}
        placeholder={`что должно случиться за ${periodAccusative(period)}…`}
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
        onToggle={(id) => commit({ items: toggleItem({ ...base(), items }, id).items })}
        onStep={(id, delta) => commit({ items: stepItem({ ...base(), items }, id, delta).items })}
        onRename={(id, text) => commit({ items: renameItem({ ...base(), items }, id, text).items })}
        onRemove={(id) => commit({ items: items.filter((i) => i.id !== id) })}
        empty="Пока пусто. Шаг — это то, про что в конце месяца можно ответить «да» или «нет»."
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
        {/* Число необязательно и пустым остаётся чаще всего: шаг с числом нужен там, где
            «да/нет» не отвечает — «в зал двенадцать раз», а не «сдать курсовую». */}
        <TextInput
          value={freshTarget}
          onChangeText={setFreshTarget}
          keyboardType="numeric"
          placeholder="раз"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.targetInput]}
          accessibilityLabel="Сколько раз"
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
          style={({ pressed }) => [styles.suggestRow, pressed && { opacity: 0.7 }]}
        >
          <Feather name="corner-down-right" size={15} color={colors.textMuted} />
          <Text style={styles.suggestText}>
            {`Перенести ${carried.length} ${plural(carried.length, [
              "невыполненный шаг",
              "невыполненных шага",
              "невыполненных шагов",
            ])} из прошлого месяца`}
          </Text>
        </Pressable>
      )}
      {repeatable.length > carried.length && (
        <Pressable
          onPress={() => commit({ items: repeatable })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.suggestRow, pressed && { opacity: 0.7 }]}
        >
          <Feather name="repeat" size={15} color={colors.textMuted} />
          <Text style={styles.suggestText}>
            {`Повторить прошлый месяц целиком — ${repeatable.length} ${plural(repeatable.length, [
              "шаг",
              "шага",
              "шагов",
            ])}`}
          </Text>
        </Pressable>
      )}

      {facts && (
        <View style={styles.factsCard}>
          <View style={styles.statRow}>
            <Stat
              value={`${facts.closed}`}
              label={`из ${facts.days} ${plural(facts.days, ["дня", "дней", "дней"])} закрыто`}
              accent
            />
            <Stat value={`${facts.best}`} label="лучшая серия в месяце" />
          </View>
          <Text style={styles.factsNote}>
            {facts.skips === 0 && facts.off === 0
              ? "Ни одного шанса и ни одного выходного."
              : `Потрачено ${facts.skips} ${plural(facts.skips, ["шанс", "шанса", "шансов"])}, выходных — ${facts.off}.`}
          </Text>
        </View>
      )}

      {started && (
        <>
          <Text style={[styles.label, styles.spaced]}>Итог</Text>
          <TextInput
            value={summary}
            onChangeText={(v) => typeLater({ summary: v })}
            onEndEditing={() => commit()}
            placeholder={
              over
                ? `что на самом деле происходило в ${periodPrepositional(period)}…`
                : "месяц ещё идёт — итог пишется в конце"
            }
            placeholderTextColor={colors.textMuted}
            multiline
            style={[styles.input, styles.summaryInput]}
            accessibilityLabel="Итог месяца"
          />
        </>
      )}

      <Text style={styles.autosave}>Сохраняется само — кнопка ниже просто закрывает.</Text>
      <Pressable
        onPress={() => {
          // Таймер мог не успеть: уходя, дописываем то, что набрано, а не то, что сохранилось.
          if (typing.current) clearTimeout(typing.current);
          save.mutate(build({}));
          navigation.goBack();
        }}
        accessibilityRole="button"
        accessibilityLabel="Готово"
        style={({ pressed }) => [styles.doneBtn, pressed && styles.dimmed]}
      >
        <Text style={styles.doneText}>Готово</Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Заголовок экрана: навигация считает период только отсюда. */
export const goalScreenTitle = (period: string): string => periodTitle(period);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  when: { color: colors.textMuted, fontSize: 12, marginBottom: 18 },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  spaced: { marginTop: 24 },
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
  summaryInput: { minHeight: 100 },
  stepsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 },
  progress: { color: colors.accentGreen, fontSize: 12, marginBottom: 6 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  addInput: { flex: 1, minHeight: 46, paddingVertical: 12 },
  targetInput: { width: 58, minHeight: 46, paddingVertical: 12, paddingHorizontal: 10, textAlign: "center" },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  dimmed: { opacity: 0.5 },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  suggestText: { color: colors.textMuted, fontSize: 12, flex: 1, lineHeight: 17 },
  factsCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 24,
  },
  statRow: { flexDirection: "row", gap: 12 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "700" },
  statValueAccent: { color: colors.accentGreen },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  factsNote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 12 },
  autosave: { color: colors.textMuted, fontSize: 11, marginTop: 24, textAlign: "center" },
  doneBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  doneText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
});
