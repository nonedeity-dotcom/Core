import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { dateNDaysAgo } from "../lib/date";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { countedDates } from "../lib/streak";
import { DEFAULT_DAY_RULE, type DayRule } from "../lib/dayRule";
import {
  WEEKDAY_LABELS,
  focusByWeek,
  formatMinutes,
  streakSummary,
  totalFocusMinutes,
  weekdayBreakdown,
} from "../lib/stats";
import type { FocusSession, Habit, HabitLog } from "../types";

/** Nothing here says anything until there is a history behind it. */
const MIN_DAYS_FOR_WEEKDAYS = 14;
/** How far the trend looks back when there is no earlier history to bound it. */
const FALLBACK_WINDOW_DAYS = 120;

/**
 * The long view: patterns that only appear over weeks, and that the report deliberately
 * doesn't show.
 *
 * The report answers "where am I today" — one number, one ring. This answers "what keeps
 * happening": which weekday the chain breaks on, how much focus time there actually is, and
 * what the streak looks like across a year rather than since the last slip.
 */
export default function StatsScreen() {
  const today = useTodayKey();

  const { data: earliest = null } = useQuery<string | null>({
    queryKey: ["earliestLog"],
    queryFn: () => api.getEarliestLogDate(),
  });
  // From the first tick ever, so "за всё время" means it. Falls back to a window when
  // nothing has been ticked yet and there is no earliest date to start from.
  const from = earliest ?? dateNDaysAgo(FALLBACK_WINDOW_DAYS);

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "all", from, today],
    queryFn: () => api.getHabitLog(from, today) as Promise<HabitLog[]>,
  });
  const { data: sessions = [] } = useQuery<FocusSession[]>({
    queryKey: ["sessions", "all", from, today],
    queryFn: () => api.getSessions(from, today) as Promise<FocusSession[]>,
  });
  const { data: freezes = [] } = useQuery<string[]>({
    queryKey: ["freezes"],
    queryFn: () => api.getFreezes(),
  });
  const { data: rule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });

  const counted = countedDates(habits, logs, rule);
  const weekdays = weekdayBreakdown(counted, from, today);
  const observed = weekdays.reduce((n, w) => n + w.total, 0);
  const streaks = streakSummary(counted, freezes, from, today);
  const weeks = focusByWeek(sessions, from, today).slice(-8);
  const focusTotal = totalFocusMinutes(sessions);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.minutes));

  // The weekday you fail most, and only when there is enough behind it to mean anything.
  const worst =
    observed >= MIN_DAYS_FOR_WEEKDAYS
      ? weekdays
          .filter((w) => w.total > 0)
          .reduce((a, b) => (b.counted / b.total < a.counted / a.total ? b : a))
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.sectionLabel}>По дням недели</Text>
      <View style={styles.card}>
        {observed < MIN_DAYS_FOR_WEEKDAYS ? (
          <Text style={styles.empty}>
            Наберётся {MIN_DAYS_FOR_WEEKDAYS} дней — здесь будет видно, в какой день недели цепочка рвётся чаще
            всего. Пока прошло {observed}.
          </Text>
        ) : (
          <>
            <View style={styles.bars}>
              {weekdays.map((w) => {
                const share = w.total > 0 ? w.counted / w.total : 0;
                const isWorst = worst?.index === w.index;
                return (
                  <View key={w.index} style={styles.barCol}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { height: `${Math.round(share * 100)}%` },
                          isWorst && styles.barFillWorst,
                        ]}
                      />
                    </View>
                    <Text style={[styles.barLabel, isWorst && styles.barLabelWorst]}>
                      {WEEKDAY_LABELS[w.index]}
                    </Text>
                    <Text style={styles.barValue}>
                      {w.counted}/{w.total}
                    </Text>
                  </View>
                );
              })}
            </View>
            {worst && (
              <Text style={styles.note}>
                Слабее всего — {WEEKDAY_LABELS[worst.index]}: {worst.counted} из {worst.total}. Хороший день,
                чтобы заранее поставить минимальный вариант.
              </Text>
            )}
          </>
        )}
      </View>

      <Text style={[styles.sectionLabel, styles.spaced]}>Серии</Text>
      <View style={styles.card}>
        <View style={styles.statRow}>
          <Stat value={String(streaks.current)} label="сейчас" />
          <Stat value={String(streaks.best)} label="лучшая" accent />
          <Stat value={String(streaks.restarts)} label="раз начинал заново" />
        </View>
        <Text style={styles.note}>
          {streaks.average > 0
            ? `Средняя длина законченной серии — ${streaks.average} ${plural(streaks.average, ["день", "дня", "дней"])}. Обрыв не отменяет пройденного: заново — это не сначала.`
            : "Пока ни одна серия не обрывалась — сравнивать не с чем."}
        </Text>
      </View>

      <Text style={[styles.sectionLabel, styles.spaced]}>Фокус</Text>
      <View style={styles.card}>
        <View style={styles.statRow}>
          <Stat value={formatMinutes(focusTotal)} label="за всё время" accent />
          <Stat value={String(sessions.length)} label={plural(sessions.length, ["сессия", "сессии", "сессий"])} />
        </View>
        {weeks.length > 0 && (
          <>
            <View style={styles.bars}>
              {weeks.map((w) => (
                <View key={w.week} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        styles.barFillFocus,
                        { height: `${Math.round((w.minutes / maxWeek) * 100)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.barValue}>{Math.round(w.minutes / 60)}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.note}>Часы фокуса по неделям, последняя — справа.</Text>
          </>
        )}
      </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 22 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  empty: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 12 },

  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 96 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barTrack: {
    width: "100%",
    height: 60,
    borderRadius: 6,
    backgroundColor: colors.bg,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { width: "100%", borderRadius: 6, backgroundColor: colors.accentGreenDark },
  barFillWorst: { backgroundColor: colors.accent },
  barFillFocus: { backgroundColor: colors.blue },
  barLabel: { color: colors.textMuted, fontSize: 10, marginTop: 5 },
  barLabelWorst: { color: colors.accent, fontWeight: "600" },
  barValue: { color: colors.textMuted, fontSize: 9, marginTop: 2 },

  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  statValueAccent: { color: colors.accentGreen },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
});
