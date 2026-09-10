import { useState } from "react";
import { View, Text, Image, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api, type AppInfoEntry } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { useTodayKey } from "../../lib/useTodayKey";
import { datesBetween, formatDateShort, weekdayLabel } from "../../lib/date";
import { formatCompact, formatDuration, formatWithUnits } from "../../lib/screen/duration";
import { dayCount, resolveSelection, shiftRange, type Selection } from "../../lib/screen/period";
import { describeChange, usageChange } from "../../lib/screen/compare";
import { hourlyFor, METRIC_LABELS, type Metric } from "../../integrations/usageSync";

const METRICS: Metric[] = ["time", "launches"];
import PeriodBar from "../../components/screen/PeriodBar";
import ValueChart, { type ChartKind } from "../../components/screen/ValueChart";
import { ChartToggle } from "./UsageScreen";
import {
  currentStreak,
  historyFor,
  longestStreak,
  maxDayUsage,
  type AppDay,
} from "../../lib/screen/usage";

/**
 * Одно приложение: сколько в нём за месяц, по каким дням и сколько дней подряд.
 *
 * Серии перенесены из creker вместе с его правилом: «пользовался» — это любое ненулевое
 * время, без порога. Порог пришлось бы объяснять, а объяснимого числа для него нет.
 */
export default function AppUsageScreen({
  route,
}: {
  route: { params?: { packageName?: string; title?: string } };
}) {
  const today = useTodayKey();
  const packageName = route.params?.packageName ?? "";
  const [selection, setSelection] = useState<Selection>({ kind: "preset", preset: "month" });
  const [metric, setMetric] = useState<Metric>("time");
  const [chart, setChart] = useState<ChartKind>("bars");
  const [picked, setPicked] = useState<string | null>(null);

  const range = resolveSelection(selection, today);
  const span = dayCount(range);
  const single = span === 1;
  const prev = shiftRange(range, -span);

  const { data: rows = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", range.from, range.to],
    queryFn: () => api.getScreenApps(range.from, range.to),
  });
  const { data: prevRows = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", prev.from, prev.to],
    queryFn: () => api.getScreenApps(prev.from, prev.to),
  });
  const { data: icons = {} } = useQuery<Record<string, AppInfoEntry>>({
    queryKey: ["appInfo"],
    queryFn: () => api.getAppInfoCache(),
  });
  const { data: hourly } = useQuery({
    queryKey: ["hourly", range.from, metric, packageName],
    // Одно приложение — своя область по определению: «общий» и «телефон» тут не значат
    // ничего, поэтому область фиксирована, а выбирать остаётся только метрику.
    queryFn: () => hourlyFor(range.from, "apps", metric, [], packageName),
    enabled: single,
  });

  const info = icons[packageName];
  const history = historyFor(rows, packageName);
  const prevHistory = historyFor(prevRows, packageName);
  const byDate = new Map(history.map((h) => [h.date, h] as const));
  const dayPoints = datesBetween(range.from, range.to).map((date) => ({
    key: date,
    label: weekdayLabel(date),
    value: metric === "launches" ? (byDate.get(date)?.launchCount ?? 0) : (byDate.get(date)?.usageMillis ?? 0),
  }));
  const hourPoints = (hourly ?? []).map((h) => ({ key: `${h.hour}`, label: `${h.hour}`, value: h.value }));

  const total = history.reduce((sum, h) => sum + h.usageMillis, 0);
  const launches = history.reduce((sum, h) => sum + h.launchCount, 0);
  const prevTotal = prevHistory.reduce((sum, h) => sum + h.usageMillis, 0);
  const prevLaunches = prevHistory.reduce((sum, h) => sum + h.launchCount, 0);
  const change = usageChange(
    metric === "launches" ? launches : total,
    metric === "launches" ? prevLaunches : prevTotal,
    span,
  );
  const daysUsed = history.filter((h) => h.usageMillis > 0).length;
  const streak = currentStreak(history, today);
  const longest = longestStreak(history);
  const peak = maxDayUsage(history);
  const pickedRow = picked ? byDate.get(picked) : undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <PeriodBar selection={selection} onChange={setSelection} today={today} />

      <View style={styles.metrics}>
        {METRICS.map((m) => (
          <Pressable
            key={m}
            onPress={() => setMetric(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: metric === m }}
            accessibilityLabel={`Метрика: ${METRIC_LABELS[m]}`}
            style={({ pressed }) => [styles.metric, metric === m && styles.metricOn, pressed && styles.pressed]}
          >
            <Text style={[styles.metricText, metric === m && styles.metricTextOn]}>{METRIC_LABELS[m]}</Text>
          </Pressable>
        ))}
      </View>

      {history.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.hint}>
            За этот период приложением не пользовались.
          </Text>
        </View>
      ) : (
        <>
      <View style={styles.card}>
        {info?.icon && (
          <Image source={{ uri: info.icon }} style={styles.bigIcon} accessibilityIgnoresInvertColors />
        )}
        <Text style={styles.big}>
          {metric === "launches" ? `${launches}` : formatDuration(total)}
        </Text>
        <Text style={styles.caption}>
          {metric === "launches"
            ? `${plural(launches, ["запуск", "запуска", "запусков"])} за ${span} ${plural(span, ["день", "дня", "дней"])}`
            : `за ${span} ${plural(span, ["день", "дня", "дней"])} · ${formatCompact(Math.round(total / span))} в день`}
        </Text>
        {change && <Text style={styles.change}>{describeChange(change)}</Text>}
        {/* «Пользуюсь три года» и «поставил неделю назад» — разные факты об одном числе. */}
        {info?.installedAtMs ? (
          <Text style={styles.caption}>
            {`Установлено ${formatDateShort(new Date(info.installedAtMs).toISOString())}`}
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.chartHead}>
          <ChartToggle kind={chart} onChange={setChart} />
        </View>
        {single && !hourly ? (
          <>
            <ValueChart points={dayPoints} kind={chart} counts={metric === "launches"} />
            <Text style={styles.hint}>
              По часам этот день не сохранился: подробные события система хранит несколько
              суток, а по отдельному приложению разбивка и вовсе живёт только эти дни.
            </Text>
          </>
        ) : single ? (
          <ValueChart points={hourPoints} kind={chart} counts={metric === "launches"} />
        ) : (
          <>
            <ValueChart
              points={dayPoints}
              kind={chart}
              counts={metric === "launches"}
              selected={picked}
              onSelect={(d) => setPicked(d === picked ? null : d)}
            />
            <Text style={styles.pickHint}>
              {pickedRow
                ? `${formatDateShort(pickedRow.date)}: ${formatWithUnits(pickedRow.usageMillis)} · ${
                    pickedRow.launchCount
                  } ${plural(pickedRow.launchCount, ["запуск", "запуска", "запусков"])}`
                : picked
                  ? `${formatDateShort(picked)}: не открывали`
                  : "Нажми на день, чтобы увидеть подробности"}
            </Text>
          </>
        )}
      </View>

      <View style={styles.figures}>
        <Figure label="Дней подряд" value={`${streak}`} hint={streak === 0 ? "сегодня ещё нет" : "включая сегодня"} />
        <Figure label="Самая долгая череда" value={`${longest}`} hint={plural(longest, ["день", "дня", "дней"])} />
      </View>
      <View style={styles.figures}>
        <Figure label={`Дней из ${span}`} value={`${daysUsed}`} hint="когда открывали" />
        <Figure label="Пик за день" value={formatCompact(peak)} hint="больше всего за сутки" />
      </View>

      <View style={styles.card}>
        <Text style={styles.rowDetail}>
          {`Всего ${launches} ${plural(launches, ["запуск", "запуска", "запусков"])} за ${span} ${plural(
            span,
            ["день", "дня", "дней"],
          )}` +
            (daysUsed > 0
              ? ` — примерно ${Math.round(launches / daysUsed)} в день, когда открывали вообще.`
              : ".")}
        </Text>
      </View>
        </>
      )}
    </ScrollView>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
    alignItems: "stretch",
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  chartHead: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 10 },
  metrics: { flexDirection: "row", gap: 6, marginBottom: 12 },
  metric: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 10, backgroundColor: colors.card },
  metricOn: { backgroundColor: "rgba(143,184,154,0.14)" },
  metricText: { color: colors.textMuted, fontSize: 12 },
  metricTextOn: { color: colors.accentGreen, fontWeight: "600" },
  pressed: { opacity: 0.75 },
  bigIcon: { width: 40, height: 40, borderRadius: 9, alignSelf: "center", marginBottom: 10 },
  change: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 },
  big: {
    color: colors.accentGreen,
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  caption: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 4 },
  pickHint: { color: colors.textMuted, fontSize: 11, marginTop: 12, textAlign: "center" },
  figures: { flexDirection: "row", gap: 12, marginBottom: 12 },
  figure: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  figureLabel: { color: colors.textMuted, fontSize: 11 },
  figureValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  figureHint: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  rowDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
