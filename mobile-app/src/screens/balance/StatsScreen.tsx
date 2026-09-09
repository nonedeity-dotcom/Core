import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { useTodayKey } from "../../lib/useTodayKey";
import { dateNDaysAgo, formatDateShort } from "../../lib/date";
import { targets, type Profile } from "../../lib/balance/profile";
import type { FoodEntry } from "../../lib/balance/food";
import { periodStats, diaryStreak, DIARY_WINDOW_DAYS, type PeriodStats } from "../../lib/balance/stats";
import { weightTrend, latestWeight, type WeightEntry, type WeightTrend } from "../../lib/balance/weight";

/**
 * Статистика: не «сколько я съел», а «сколько я ем обычно».
 *
 * Один день ничего не значит — вчера был день рождения, позавчера был перелёт. Смысл
 * появляется на семи и тридцати днях, и рядом с каждым средним стоит, по скольким дням оно
 * посчитано: среднее по двум дням из семи — это не неделя, и экран говорит об этом прямо,
 * а не делает вид, что цифра полновесная.
 */
export default function StatsScreen() {
  // Сегодняшний ключ нужен не для запроса, а чтобы окно пересчиталось на смене суток.
  const today = useTodayKey();
  const from = dateNDaysAgo(DIARY_WINDOW_DAYS - 1);

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ["balanceProfile"],
    queryFn: () => api.getBalanceProfile(),
  });
  const { data: entries = [] } = useQuery<FoodEntry[]>({
    queryKey: ["foodLog", "stats", today],
    queryFn: () => api.getFoodLog(from, today),
  });
  const { data: weightLog = [] } = useQuery<WeightEntry[]>({
    queryKey: ["weightLog"],
    queryFn: () => api.getWeightLog(),
  });

  const target = profile ? targets(profile) : null;
  const streak = diaryStreak(entries);
  const week = periodStats(entries, 7);
  const month = periodStats(entries, 30);
  const weightNow = latestWeight(weightLog);
  const weekWeight = weightTrend(weightLog, 7, today);
  const monthWeight = weightTrend(weightLog, 30, today);

  if (entries.length === 0 && weightLog.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Пока нечего усреднять. Запиши хотя бы один день в дневнике — средние появятся
            здесь сами, и чем дольше ведётся дневник, тем меньше в них случайного.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.streakCard}>
        <Text style={styles.streakValue}>{streak}</Text>
        <Text style={styles.streakLabel}>{plural(streak, ["день", "дня", "дней"])} подряд с дневником</Text>
        {streak === 0 && (
          <Text style={styles.streakHint}>
            Вчера записей не было — серия начнётся заново с первого записанного дня.
          </Text>
        )}
      </View>

      <Period title="За 7 дней" stats={week} target={target} trend={weekWeight} />
      <Period title="За 30 дней" stats={month} target={target} trend={monthWeight} />

      {weightNow && (
        <Text style={styles.footnote}>
          {`Последнее взвешивание: ${weightNow.kg.toFixed(1)} кг, ${formatDateShort(weightNow.date)}. ` +
            "Вес за сутки скачет почти на килограмм от воды и соли, поэтому сдвиг считается " +
            "по средним за половины периода, а не по двум крайним взвешиваниям."}
        </Text>
      )}
      {!weightNow && (
        <Text style={styles.footnote}>
          Записывай вес в дневнике — и здесь появится, что он делает при таком питании. Без
          этого средние калории остаются числом, про которое неизвестно, работает оно или нет.
        </Text>
      )}

      {!target && (
        <Text style={styles.footnote}>
          Заполни профиль — и рядом со средними появится, насколько они расходятся с нормой.
        </Text>
      )}
    </ScrollView>
  );
}

function Period({
  title,
  stats,
  target,
  trend,
}: {
  title: string;
  stats: PeriodStats;
  target: { calories: number; proteinG: number } | null;
  trend: WeightTrend | null;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.coverage}>
          {stats.daysLogged === 0
            ? "нет записей"
            : `по ${stats.daysLogged} ${plural(stats.daysLogged, ["дню", "дням", "дням"])} из ${stats.days}`}
        </Text>
      </View>

      {stats.daysLogged === 0 ? (
        <Text style={styles.hint}>За этот период дневник не вёлся.</Text>
      ) : (
        <>
          <View style={styles.figures}>
            <Figure
              label="Калории"
              value={`${stats.average.kcal}`}
              unit="ккал в день"
              diff={target ? stats.average.kcal - target.calories : null}
              diffUnit="ккал"
            />
            <Figure
              label="Белок"
              value={`${stats.average.protein}`}
              unit="г в день"
              diff={target ? Math.round((stats.average.protein - target.proteinG) * 10) / 10 : null}
              diffUnit="г"
            />
          </View>
          <Text style={styles.rest}>
            {`Жиры ${stats.average.fat} г · углеводы ${stats.average.carb} г в день`}
          </Text>
        </>
      )}

      {/* Вес стоит именно здесь, под калориями того же периода: по отдельности это две
          цифры, вместе — ответ на вопрос, работает ли норма. */}
      {trend && (
        <View style={styles.trend}>
          <Text style={styles.trendLine}>
            {`Вес: ${trend.from.toFixed(1)} → ${trend.to.toFixed(1)} кг · ${signed(trend.deltaKg)} кг`}
          </Text>
          <Text style={styles.trendHint}>
            {trend.deltaKg === 0
              ? `Стоит на месте. ${trend.points} ${plural(trend.points, [
                  "взвешивание",
                  "взвешивания",
                  "взвешиваний",
                ])}.`
              : `${signed(trend.perWeek)} кг в неделю в этом темпе · ${trend.points} ${plural(trend.points, [
                  "взвешивание",
                  "взвешивания",
                  "взвешиваний",
                ])}`}
          </Text>
        </View>
      )}
      {!trend && stats.daysLogged > 0 && (
        <Text style={styles.trendHint}>
          Веса за этот период меньше двух — сказать, куда он идёт, пока нечем.
        </Text>
      )}
    </View>
  );
}

/** Число со знаком: «+0.3», «−1.2», и ноль без знака. Минус — типографский, не дефис. */
function signed(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
}

/**
 * Отклонение от нормы — цифрой со знаком, без цвета «плохо».
 *
 * Минус по калориям при похудении — это ровно то, чего добивались, а плюс при наборе тоже;
 * какой знак хороший, зависит от цели, и экран не берётся это решать за человека.
 */
function Figure({
  label,
  value,
  unit,
  diff,
  diffUnit,
}: {
  label: string;
  value: string;
  unit: string;
  diff: number | null;
  diffUnit: string;
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureUnit}>{unit}</Text>
      {diff !== null && (
        <Text style={styles.figureDiff}>
          {diff === 0 ? "ровно норма" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${diffUnit} к норме`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  streakCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 16,
    alignItems: "center",
  },
  streakValue: { color: colors.accentGreen, fontSize: 40, fontWeight: "700", letterSpacing: -1 },
  streakLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  streakHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 10 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  head: { flexDirection: "row", alignItems: "baseline", marginBottom: 14 },
  title: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
  coverage: { color: colors.textMuted, fontSize: 11 },
  figures: { flexDirection: "row", gap: 12 },
  figure: { flex: 1 },
  figureLabel: { color: colors.textMuted, fontSize: 11 },
  figureValue: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  figureUnit: { color: colors.textMuted, fontSize: 11 },
  figureDiff: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  rest: { color: colors.textMuted, fontSize: 12, marginTop: 14 },
  trend: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 12 },
  trendLine: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  trendHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
});
