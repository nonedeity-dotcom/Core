import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, DEFAULT_CALENDAR_PREFS, type CalendarPrefs } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { dateNDaysAgo } from "../lib/date";
import { DEFAULT_DAY_RULE, type DayRule } from "../lib/dayRule";
import {
  buildMonthGrid,
  buildWeeksGrid,
  compareWithPrevious,
  computeDayStates,
  singleHabitDayStates,
  countedDays,
  elapsedDays,
  monthKey,
  monthLabel,
  monthRange,
  shiftMonth,
  GRID_WEEKS,
  type Cell,
} from "../lib/calendar";
import type { Habit, HabitLog } from "../types";
import { useState } from "react";
import { useFold } from "../lib/useFold";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/**
 * The chain, folded away under the streak until you ask for it.
 *
 * Two views because they answer different questions: a real calendar month
 * is how people think about "how was September", while four rolling weeks is
 * the run you are actually in the middle of — a chain crossing the 1st looks
 * broken in a month view even though it isn't.
 */
export default function HistoryCalendar({
  today,
  habits,
  accent,
  frozen = [],
  habit,
  alwaysOpen = false,
}: {
  today: string;
  habits: Habit[];
  /**
   * Colour for the fold-out toggle only — it lives inside the streak card and follows its
   * stretch. The day cells keep green deliberately: "done" means the same thing in every
   * stretch, and recolouring it would turn a fact into decoration.
   */
  accent?: string;
  /** Days kept by the weekly freeze — drawn as their own state, not as done. */
  frozen?: string[];
  /**
   * When set, the grid shows this one habit instead of whether the day as a whole counted —
   * the per-habit report asks "when did I skip *this*".
   */
  habit?: Habit;
  /**
   * Skips the fold-away header. On the habit's own report the calendar is the content, not
   * a detail tucked under a number, and it shares the collapsed/open preference with the
   * report's copy — which would otherwise fold this one shut too.
   */
  alwaysOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(today));
  // Not stored: unfolding the calendar lasts until you leave the screen. Only which of the
  // two views you like is a preference worth keeping.
  const { open, toggle: toggleOpen } = useFold();

  const { data: prefs = DEFAULT_CALENDAR_PREFS } = useQuery<CalendarPrefs>({
    queryKey: ["calendarPrefs"],
    queryFn: () => api.getCalendarPrefs(),
  });
  const savePrefs = useMutation({
    mutationFn: (next: CalendarPrefs) => api.setCalendarPrefs(next),
    onSuccess: (applied) => qc.setQueryData(["calendarPrefs"], applied),
  });

  const { data: earliest = null } = useQuery<string | null>({
    queryKey: ["earliestLog"],
    queryFn: () => api.getEarliestLogDate(),
  });

  // Only the range on screen is fetched, so paging back years costs nothing
  // until you actually go there.
  const range =
    prefs.mode === "month"
      ? monthRange(shiftMonth(visibleMonth, -1)).from // include the previous month for the comparison
      : dateNDaysAgo(GRID_WEEKS * 7 + 7);
  const rangeTo = prefs.mode === "month" ? monthRange(visibleMonth).to : today;

  const { data: rule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "calendar", range, rangeTo],
    queryFn: () => api.getHabitLog(range, rangeTo) as Promise<HabitLog[]>,
    enabled: open || alwaysOpen,
  });

  const frozenDays = new Set(frozen);
  // Read here rather than passed down: two screens render this component and both would
  // have to thread the same setting through for the calendar to agree with the ring.
  const states = habit ? singleHabitDayStates(habit, logs) : computeDayStates(habits, logs, rule);
  const cells: Cell[] =
    prefs.mode === "month"
      ? buildMonthGrid(visibleMonth, today, states, frozenDays)
      : buildWeeksGrid(today, states, frozenDays);
  const counted = countedDays(cells);
  const elapsed = elapsedDays(cells);
  const delta = compareWithPrevious(prefs.mode, visibleMonth, today, states);
  const hasMinimal = cells.some((c) => c.state === "minimal");
  const hasFrozen = cells.some((c) => c.state === "frozen");

  const currentMonth = monthKey(today);
  const canGoBack = earliest !== null && shiftMonth(visibleMonth, -1) >= monthKey(earliest);
  const canGoForward = visibleMonth < currentMonth;

  const setMode = (mode: CalendarPrefs["mode"]) => {
    setVisibleMonth(currentMonth);
    savePrefs.mutate({ ...prefs, mode });
  };

  return (
    <View style={styles.wrap}>
      {!alwaysOpen && (
        <Pressable
          onPress={toggleOpen}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel="Календарь привычек"
          style={({ pressed }) => [styles.header, pressed && styles.dimmed]}
        >
          <Text style={[styles.headerText, accent ? { color: accent } : null]}>Календарь</Text>
          <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={accent ?? colors.textMuted} />
        </Pressable>
      )}

      {(open || alwaysOpen) && (
        <>
          <View style={styles.modeRow}>
            {([
              ["month", "Месяц"],
              ["weeks", "4 недели"],
            ] as const).map(([mode, label]) => (
              <Pressable
                key={mode}
                onPress={() => setMode(mode)}
                accessibilityRole="button"
                accessibilityState={{ selected: prefs.mode === mode }}
                style={({ pressed }) => [
                  styles.modeChip,
                  prefs.mode === mode && styles.modeChipOn,
                  pressed && styles.dimmed,
                ]}
              >
                <Text style={[styles.modeText, prefs.mode === mode && styles.modeTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {prefs.mode === "month" && (
            <View style={styles.navRow}>
              <Pressable
                onPress={() => canGoBack && setVisibleMonth(shiftMonth(visibleMonth, -1))}
                disabled={!canGoBack}
                accessibilityRole="button"
                accessibilityLabel="Предыдущий месяц"
                style={({ pressed }) => [styles.navBtn, (!canGoBack || pressed) && styles.dimmed]}
              >
                <Feather name="chevron-left" size={16} color={colors.textMuted} />
              </Pressable>
              <Text style={styles.monthName}>{monthLabel(visibleMonth)}</Text>
              <Pressable
                onPress={() => canGoForward && setVisibleMonth(shiftMonth(visibleMonth, 1))}
                disabled={!canGoForward}
                accessibilityRole="button"
                accessibilityLabel="Следующий месяц"
                style={({ pressed }) => [styles.navBtn, (!canGoForward || pressed) && styles.dimmed]}
              >
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          <View style={styles.row}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekday}>
                {w}
              </Text>
            ))}
          </View>

          {Array.from({ length: cells.length / 7 }, (_, week) => (
            <View key={week} style={styles.row}>
              {cells.slice(week * 7, week * 7 + 7).map((cell, i) => (
                <View
                  key={cell.date ?? `blank-${week}-${i}`}
                  style={[
                    styles.cell,
                    cell.date === null && styles.cellBlank,
                    cell.state === "full" && styles.cellFull,
                    cell.state === "minimal" && styles.cellMinimal,
                    cell.state === "frozen" && styles.cellFrozen,
                    cell.date !== null && cell.state === "future" && styles.cellFuture,
                    cell.isToday && styles.cellToday,
                  ]}
                >
                  {cell.date !== null && (
                    <Text
                      style={[
                        styles.dayNumber,
                        (cell.state === "full" || cell.state === "minimal") && styles.dayNumberOn,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ))}

          <View style={styles.summaryRow}>
            <Text style={styles.summary}>
              {counted} из {elapsed} {plural(elapsed, ["дня", "дней", "дней"])}
            </Text>
            {delta !== null && delta !== 0 && (
              <Text style={[styles.delta, delta < 0 && { color: colors.accent }]}>
                {delta > 0 ? "+" : ""}
                {delta} к прошл{prefs.mode === "month" ? "ому месяцу" : "ой неделе"}
              </Text>
            )}
          </View>

          {(hasMinimal || hasFrozen) && (
            <View style={styles.legend}>
              {hasMinimal && (
                <>
                  <View style={[styles.swatch, styles.cellFull]} />
                  <Text style={styles.legendText}>полностью</Text>
                  <View style={[styles.swatch, styles.cellMinimal]} />
                  <Text style={styles.legendText}>по минимуму</Text>
                </>
              )}
              {hasFrozen && (
                <>
                  <View style={[styles.swatch, styles.cellFrozen]} />
                  <Text style={styles.legendText}>пропуск, серия цела</Text>
                </>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", borderTopWidth: 1, borderTopColor: colors.cardBorder, marginTop: 16, paddingTop: 4 },
  dimmed: { opacity: 0.55 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  headerText: { color: colors.textMuted, fontSize: 12 },

  modeRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4, marginBottom: 12 },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modeChipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  modeText: { color: colors.textMuted, fontSize: 12 },
  modeTextOn: { color: colors.accentGreen, fontWeight: "600" },

  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 10 },
  navBtn: { padding: 6 },
  monthName: { color: colors.text, fontSize: 13, fontWeight: "600", minWidth: 110, textAlign: "center" },

  row: { flexDirection: "row", gap: 4, marginBottom: 4 },
  weekday: { flex: 1, color: colors.textMuted, fontSize: 9, textAlign: "center", marginBottom: 2 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 5,
    backgroundColor: "#22262e",
    alignItems: "center",
    justifyContent: "center",
  },
  cellBlank: { backgroundColor: "transparent" },
  cellFull: { backgroundColor: colors.accentGreen },
  cellMinimal: { backgroundColor: colors.accentGreenDark, opacity: 0.55 },
  // Outlined, not filled: the day held the chain but nothing was done on it, and a fill
  // would read as another done day when you glance at the month.
  cellFrozen: { borderWidth: 1, borderColor: colors.accentGreen, borderStyle: "dashed" },
  cellFuture: { backgroundColor: "#1a1e25" },
  cellToday: { borderWidth: 2, borderColor: colors.accent },
  dayNumber: { color: colors.textMuted, fontSize: 9 },
  dayNumberOn: { color: colors.bg, fontWeight: "600" },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  summary: { color: colors.textMuted, fontSize: 11 },
  delta: { color: colors.accentGreen, fontSize: 11 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendText: { color: colors.textMuted, fontSize: 10, marginRight: 8 },
});
