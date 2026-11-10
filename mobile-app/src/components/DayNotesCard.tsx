import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { formatDayLong, weekdayLabel } from "../lib/date";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { monthOf, monthTitle, monthWeeks, previewOf, shiftMonth, type DayNote, type MonthRef } from "../lib/dayNotes";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/**
 * «Итоги дня» на Отчёте: календарь, в котором отмечены дни с итогом, итог выбранного дня и
 * вход в список всех итогов.
 *
 * Выбирается любой день до сегодняшнего включительно: итог можно написать в тот же день и
 * задним числом. Дни вперёд не выбираются — итог о том, чего ещё не было, не бывает.
 * Полностью итог открывается отдельным экраном, здесь только начало.
 */
export default function DayNotesCard({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void };
}) {
  const today = useTodayKey();
  const [view, setView] = useState<MonthRef>(() => monthOf(today));
  const [selected, setSelected] = useState(today);

  const { data: notes = [] } = useQuery<DayNote[]>({
    queryKey: ["dayNotes"],
    queryFn: () => api.getDayNotes(),
  });
  const byDate = useMemo(() => new Map(notes.map((n) => [n.date, n])), [notes]);
  const weeks = useMemo(() => monthWeeks(view), [view]);

  const thisMonth = monthOf(today);
  const canGoForward = view.year * 12 + view.month < thisMonth.year * 12 + thisMonth.month;

  const note = byDate.get(selected);
  const open = (date: string) =>
    navigation.navigate("DayNote", { date, title: formatDayLong(date) });

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Итоги дня</Text>

      <View style={styles.monthRow}>
        <Pressable
          onPress={() => setView((v) => shiftMonth(v, -1))}
          accessibilityRole="button"
          accessibilityLabel="Предыдущий месяц"
          hitSlop={10}
          style={styles.arrow}
        >
          <Feather name="chevron-left" size={20} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.monthTitle}>{monthTitle(view)}</Text>
        <Pressable
          onPress={() => canGoForward && setView((v) => shiftMonth(v, 1))}
          accessibilityRole="button"
          accessibilityLabel="Следующий месяц"
          accessibilityState={{ disabled: !canGoForward }}
          hitSlop={10}
          style={[styles.arrow, !canGoForward && { opacity: 0.25 }]}
        >
          <Feather name="chevron-right" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d) => (
          <Text key={d} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((date, di) => {
            if (!date) return <View key={di} style={styles.cell} />;
            const has = byDate.has(date);
            const future = date > today;
            const isToday = date === today;
            const isSelected = date === selected;
            return (
              <Pressable
                key={di}
                disabled={future}
                onPress={() => setSelected(date)}
                accessibilityRole="button"
                accessibilityLabel={`${formatDayLong(date)}${has ? ", есть итог" : ""}`}
                accessibilityState={{ selected: isSelected, disabled: future }}
                style={styles.cell}
              >
                <View
                  style={[
                    styles.day,
                    has && styles.dayWithNote,
                    isToday && styles.dayToday,
                    isSelected && styles.daySelected,
                    future && { opacity: 0.3 },
                  ]}
                >
                  <Text style={[styles.dayText, has && styles.dayTextWithNote, isToday && { color: colors.accent }]}>
                    {Number(date.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.panel}>
        <Text style={styles.panelDate}>
          {formatDayLong(selected)} · {weekdayLabel(selected)}
        </Text>
        {note ? (
          <Pressable
            onPress={() => open(selected)}
            accessibilityRole="button"
            accessibilityLabel={`Итог за ${formatDayLong(selected)}, открыть на весь экран`}
            style={({ pressed }) => pressed && { opacity: 0.7 }}
          >
            <Text style={styles.panelText} numberOfLines={5}>
              {previewOf(note.text, 400)}
            </Text>
            <Text style={styles.panelHint}>Открыть на весь экран ›</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => open(selected)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.writeBtn, pressed && { opacity: 0.7 }]}
          >
            <Feather name="edit-3" size={15} color={colors.accentGreen} />
            <Text style={styles.writeText}>
              {selected === today ? "Написать итог дня" : "Добавить итог за этот день"}
            </Text>
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={() => navigation.navigate("DayNotes")}
        accessibilityRole="button"
        accessibilityLabel="Все итоги"
        style={({ pressed }) => [styles.allRow, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.allText}>
          {notes.length > 0
            ? `Все итоги · ${notes.length} ${plural(notes.length, ["итог", "итога", "итогов"])}`
            : "Все итоги"}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
  },
  heading: { color: colors.text, fontSize: 14, fontWeight: "600" },

  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  arrow: { width: 36, height: 32, alignItems: "center", justifyContent: "center" },
  monthTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },

  weekRow: { flexDirection: "row", marginTop: 4 },
  weekday: { flex: 1, textAlign: "center", color: colors.textMuted, fontSize: 10 },
  cell: { flex: 1, alignItems: "center", justifyContent: "center", height: 38 },
  day: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  dayWithNote: { backgroundColor: "rgba(143,184,154,0.22)" },
  dayToday: { borderColor: colors.accent },
  daySelected: { borderColor: colors.text, borderWidth: 1.5 },
  dayText: { color: colors.textMuted, fontSize: 12 },
  dayTextWithNote: { color: colors.accentGreen, fontWeight: "700" },

  panel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  panelDate: { color: colors.textMuted, fontSize: 11 },
  panelText: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 8 },
  panelHint: { color: colors.accentGreen, fontSize: 12, marginTop: 8 },
  writeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(143,184,154,0.12)",
  },
  writeText: { color: colors.accentGreen, fontSize: 14, fontWeight: "600" },

  allRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  allText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  chevron: { color: colors.textMuted, fontSize: 20 },
});
