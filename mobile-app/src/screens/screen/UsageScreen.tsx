import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { useTodayKey } from "../../lib/useTodayKey";
import { datesBetween } from "../../lib/date";
import { syncFromCreker } from "../../integrations/screenTime";
import { formatCompact } from "../../lib/screen/duration";
import {
  PRESET_LABELS,
  dayCount,
  describeRange,
  resolveSelection,
  shiftRange,
  type Preset,
  type Selection,
} from "../../lib/screen/period";
import { totalScreenMillis, totalsByApp, type AppDay, type ScreenDay } from "../../lib/screen/usage";
import UsageRing, { sliceColor } from "../../components/screen/UsageRing";
import UsageBars from "../../components/screen/UsageBars";

const PRESETS: Preset[] = ["day", "yesterday", "week", "month"];

/**
 * «Экран»: сколько времени ушло в телефон и куда именно.
 *
 * Данные меряет creker, а живут они здесь — своей копией. Так и задумано на этом шаге:
 * creker пока измеряет, приложение показывает, и когда измерение переедет сюда, экраны
 * менять не придётся, потому что они и сейчас читают не creker, а своё хранилище.
 */
export default function UsageScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: object) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const [selection, setSelection] = useState<Selection>({ kind: "preset", preset: "day" });
  const range = resolveSelection(selection, today);

  const { data: days = [] } = useQuery<ScreenDay[]>({
    queryKey: ["screenDays", range.from, range.to],
    queryFn: () => api.getScreenDays(range.from, range.to),
  });
  const { data: apps = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", range.from, range.to],
    queryFn: () => api.getScreenApps(range.from, range.to),
  });
  const { data: importedThrough } = useQuery<string | null>({
    queryKey: ["screenImported"],
    queryFn: () => api.getScreenImportedThrough(),
  });

  const sync = useMutation({
    mutationFn: () => syncFromCreker(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenDays"] });
      qc.invalidateQueries({ queryKey: ["screenApps"] });
      qc.invalidateQueries({ queryKey: ["screenImported"] });
    },
  });

  const totalMs = totalScreenMillis(days);
  const totals = totalsByApp(apps);
  const byDate = new Map(days.map((d) => [d.date, d.screenMillis] as const));
  const bars = datesBetween(range.from, range.to).map((date) => ({ date, value: byDate.get(date) ?? 0 }));
  const spanDays = dayCount(range);
  const empty = totalMs === 0 && totals.length === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View style={styles.presets}>
        {PRESETS.map((preset) => {
          const on = selection.kind === "preset" && selection.preset === preset;
          return (
            <Pressable
              key={preset}
              onPress={() => setSelection({ kind: "preset", preset })}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Период: ${PRESET_LABELS[preset]}`}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{PRESET_LABELS[preset]}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Шаг окном: неделю назад — это неделя целиком, а не один день. Пресет при этом
          перестаёт быть пресетом, иначе следующая полночь утащила бы диапазон обратно. */}
      <View style={styles.nav}>
        <Pressable
          onPress={() => setSelection({ kind: "fixed", range: shiftRange(range, -spanDays) })}
          accessibilityRole="button"
          accessibilityLabel="Предыдущий период"
          hitSlop={10}
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
        >
          <Feather name="chevron-left" size={18} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.rangeLabel}>{describeRange(range, today)}</Text>
        <Pressable
          onPress={() => setSelection({ kind: "fixed", range: shiftRange(range, spanDays) })}
          disabled={range.to >= today}
          accessibilityRole="button"
          accessibilityLabel="Следующий период"
          hitSlop={10}
          style={({ pressed }) => [styles.navBtn, range.to >= today && styles.navBtnOff, pressed && styles.pressed]}
        >
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      {empty ? (
        <View style={styles.card}>
          <Text style={styles.hint}>
            {importedThrough === null
              ? "История ещё не перенесена. Нажми «Обновить из creker» — приложение заберёт всё, что creker намерил, и дальше будет показывать это само."
              : "За этот период данных нет. creker хранит только то, что успел намерить, — до его установки истории не существует."}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <UsageRing totals={totals} totalMs={totalMs} />
            {spanDays > 1 && (
              <Text style={styles.perDay}>
                {`${formatCompact(Math.round(totalMs / spanDays))} в день в среднем за ${spanDays} ${plural(
                  spanDays,
                  ["день", "дня", "дней"],
                )}`}
              </Text>
            )}
          </View>

          {spanDays > 1 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>По дням</Text>
              <UsageBars bars={bars} />
            </View>
          )}

          <Text style={styles.sectionLabel}>
            {`Приложения · ${totals.length} ${plural(totals.length, ["штука", "штуки", "штук"])}`}
          </Text>
          {totals.map((total, i) => (
            <Pressable
              key={total.packageName}
              onPress={() =>
                navigation.navigate("AppUsage", {
                  packageName: total.packageName,
                  title: total.label,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${total.label}, ${formatCompact(total.usageMillis)}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.dot, { backgroundColor: sliceColor(i) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {total.label}
                </Text>
                <Text style={styles.rowDetail}>
                  {`${total.launchCount} ${plural(total.launchCount, ["запуск", "запуска", "запусков"])}`}
                  {spanDays > 1
                    ? ` · ${total.daysUsed} ${plural(total.daysUsed, ["день", "дня", "дней"])} из ${spanDays}`
                    : ""}
                </Text>
              </View>
              <Text style={styles.rowValue}>{formatCompact(total.usageMillis)}</Text>
            </Pressable>
          ))}
        </>
      )}

      {/* Пока измеряет creker, обновление — ручное действие, и оно названо своим именем.
          Когда измерение переедет сюда, эта кнопка исчезнет вместе с зависимостью. */}
      <Pressable
        onPress={() => sync.mutate()}
        disabled={sync.isPending}
        accessibilityRole="button"
        accessibilityLabel="Обновить из creker"
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Feather name="refresh-cw" size={15} color={colors.textMuted} />
        <Text style={styles.addText}>{sync.isPending ? "Забираю…" : "Обновить из creker"}</Text>
      </Pressable>
      {sync.isSuccess && (
        <Text style={styles.syncNote}>
          {sync.data.days === 0 && sync.data.apps === 0
            ? "creker ничего не ответил: он не установлен, не пускает это приложение или слишком старой сборки. Разреши доступ в настройках creker."
            : `Перенесено: ${sync.data.days} ${plural(sync.data.days, ["день", "дня", "дней"])}, ${
                sync.data.apps
              } ${plural(sync.data.apps, ["строка", "строки", "строк"])} по приложениям${
                sync.data.earliest ? `, начиная с ${sync.data.earliest}` : ""
              }.`}
        </Text>
      )}
      <Text style={styles.footnote}>
        Пока считает creker, а «Стержень» хранит копию у себя. Не удаляй creker, пока перенос
        не сработал хотя бы раз: его история живёт внутри него, и вместе с ним она исчезнет.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  nav: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  navBtnOff: { opacity: 0.3 },
  rangeLabel: { flex: 1, textAlign: "center", color: colors.text, fontSize: 14, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 12 },
  perDay: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 12 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginTop: 6, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pressed: { opacity: 0.75 },
  rowName: { color: colors.text, fontSize: 14 },
  rowDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
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
    marginTop: 10,
  },
  addText: { color: colors.textMuted, fontSize: 13 },
  syncNote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
});
