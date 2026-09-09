import { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { useTodayKey } from "../../lib/useTodayKey";
import { datesBetween, dateNDaysAgo, formatDateShort } from "../../lib/date";
import { formatCompact, formatDuration, formatWithUnits } from "../../lib/screen/duration";
import { MONTH_DAYS } from "../../lib/screen/period";
import {
  currentStreak,
  historyFor,
  longestStreak,
  maxDayUsage,
  type AppDay,
} from "../../lib/screen/usage";
import UsageBars from "../../components/screen/UsageBars";

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
  const from = dateNDaysAgo(MONTH_DAYS - 1);
  const [picked, setPicked] = useState<string | null>(null);

  const { data: rows = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", from, today],
    queryFn: () => api.getScreenApps(from, today),
  });

  const history = historyFor(rows, packageName);
  const byDate = new Map(history.map((h) => [h.date, h] as const));
  const bars = datesBetween(from, today).map((date) => ({
    date,
    value: byDate.get(date)?.usageMillis ?? 0,
  }));

  const total = history.reduce((sum, h) => sum + h.usageMillis, 0);
  const launches = history.reduce((sum, h) => sum + h.launchCount, 0);
  const daysUsed = history.filter((h) => h.usageMillis > 0).length;
  const streak = currentStreak(history, today);
  const longest = longestStreak(history);
  const peak = maxDayUsage(history);
  const pickedRow = picked ? byDate.get(picked) : undefined;

  if (history.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.hint}>
            За последний месяц этим приложением не пользовались — или история за эти дни ещё
            не перенесена из creker.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.big}>{formatDuration(total)}</Text>
        <Text style={styles.caption}>{`за 30 дней · ${formatCompact(Math.round(total / MONTH_DAYS))} в день`}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>По дням</Text>
        <UsageBars bars={bars} selected={picked} onSelect={(d) => setPicked(d === picked ? null : d)} />
        <Text style={styles.pickHint}>
          {pickedRow
            ? `${formatDateShort(pickedRow.date)}: ${formatWithUnits(pickedRow.usageMillis)} · ${
                pickedRow.launchCount
              } ${plural(pickedRow.launchCount, ["запуск", "запуска", "запусков"])}`
            : picked
              ? `${formatDateShort(picked)}: не открывали`
              : "Нажми на столбик, чтобы увидеть день"}
        </Text>
      </View>

      <View style={styles.figures}>
        <Figure label="Дней подряд" value={`${streak}`} hint={streak === 0 ? "сегодня ещё нет" : "включая сегодня"} />
        <Figure label="Самая долгая череда" value={`${longest}`} hint={plural(longest, ["день", "дня", "дней"])} />
      </View>
      <View style={styles.figures}>
        <Figure label="Дней из 30" value={`${daysUsed}`} hint="когда открывали" />
        <Figure label="Пик за день" value={formatCompact(peak)} hint="больше всего за сутки" />
      </View>

      <View style={styles.card}>
        <Text style={styles.rowDetail}>
          {`Всего ${launches} ${plural(launches, ["запуск", "запуска", "запусков"])} за 30 дней` +
            (daysUsed > 0
              ? ` — примерно ${Math.round(launches / daysUsed)} в день, когда открывали вообще.`
              : ".")}
        </Text>
      </View>
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
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "600", marginBottom: 12 },
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
