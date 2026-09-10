import { useEffect } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { formatDayLong } from "../lib/date";
import { useStreak } from "../lib/useStreak";
import { dayProgress, habitsThatDecideTheDay } from "../lib/habits";
import { phaseStepFor } from "../lib/phase";
import { sumNutrition, type FoodEntry } from "../lib/balance/food";
import { targets, type Profile } from "../lib/balance/profile";
import { totalScreenMillis, totalUnlocks, type ScreenDay } from "../lib/screen/usage";
import { formatCompact } from "../lib/screen/duration";
import { hasUsageAccess } from "../../modules/creker-usage";
import { syncUsage } from "../integrations/usageSync";
import type { Section } from "../navigation/SectionMenu";

/**
 * Главная — один вопрос: как идёт сегодняшний день.
 *
 * Не сводка и не панель с показателями. Панель из пятнадцати чисел через неделю листают не
 * читая, а сводный балл — «день на 76 %» — складывает вещи, которые не складываются:
 * привычки, калории и часы экрана меряются в разном и отвечают на разное. Поэтому здесь три
 * строки, по одной на раздел, у каждой одно главное число и одна строка пояснения.
 *
 * Экран умеет ровно две вещи: показать и пропустить дальше. Отмечать привычки и записывать
 * еду отсюда нельзя намеренно — это повтор чек-листа и дневника, а у главной другая работа:
 * закрываться за три секунды.
 */
export default function HomeScreen({ onOpen }: { onOpen: (section: Section) => void }) {
  const qc = useQueryClient();
  const today = useTodayKey();

  // --- Sterzhen ---
  const { streak, habits, logs } = useStreak(today);
  const deciding = habitsThatDecideTheDay(habits, today);
  const done = deciding.filter((h) => {
    const p = dayProgress(h, logs, today);
    return p.count >= p.target;
  }).length;
  const phase = phaseStepFor(streak);

  // --- CaloriX ---
  const { data: profile } = useQuery<Profile | null>({
    queryKey: ["balanceProfile"],
    queryFn: () => api.getBalanceProfile(),
  });
  const { data: entries = [] } = useQuery<FoodEntry[]>({
    queryKey: ["foodLog", today, today],
    queryFn: () => api.getFoodLog(today, today),
  });
  const eaten = sumNutrition(entries);
  const target = profile ? targets(profile) : null;

  // --- Creker ---
  const { data: days = [] } = useQuery<ScreenDay[]>({
    queryKey: ["screenDays", today, today],
    queryFn: () => api.getScreenDays(today, today),
  });
  const { data: limit = 0 } = useQuery<number>({
    queryKey: ["screenTimeLimit"],
    queryFn: () => api.getScreenTimeLimitMinutes(),
  });
  const screenMs = totalScreenMillis(days);
  const unlocks = totalUnlocks(days);
  const access = hasUsageAccess();

  /**
   * Пересчёт при открытии.
   *
   * Экранное время копится, пока приложение закрыто, и без этого главная показывала бы
   * число, снятое в прошлый заход, — то есть врала бы ровно тому, кто открыл её узнать,
   * как идёт день.
   */
  const measure = useMutation({
    mutationFn: () => syncUsage(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenDays"] });
      qc.invalidateQueries({ queryKey: ["screenApps"] });
    },
  });
  useEffect(() => {
    if (access) measure.mutate();
    // Один раз на открытие: mutate пересоздаётся на каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, today]);

  /**
   * Про экран есть что сказать, если за сегодня уже что-то намерено.
   *
   * Доступ могли отобрать посреди дня — часы, посчитанные до этого, никуда не делись, и
   * заменять их на «нет доступа» значило бы прятать известное число за жалобой.
   */
  const screenKnown = days.length > 0;
  const noHabits = deciding.length === 0;
  const allDone = !noHabits && done === deciding.length;
  const overLimit = limit > 0 && screenMs > limit * 60_000;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.date}>{`Сегодня, ${formatDayLong(today)}`}</Text>
      <Text style={styles.lead}>Как идёт день</Text>

      <Card
        name="Sterzhen"
        onPress={() => onOpen("sterzhen")}
        value={noHabits ? "Пока пусто" : `${done} из ${deciding.length}`}
        tone={allDone ? "done" : "plain"}
        big={!noHabits}
        hint={
          noHabits
            ? "Добавь первую привычку — в чек-листе"
            : `${plural(deciding.length, ["привычка", "привычки", "привычек"])} на сегодня${
                streak > 0
                  ? ` · серия ${streak} ${plural(streak, ["день", "дня", "дней"])}`
                  : " · серии пока нет"
              }${phase && streak > 0 ? ` · ${phase.title.toLowerCase()}` : ""}`
        }
      />

      <Card
        name="CaloriX"
        onPress={() => onOpen("balance")}
        value={
          !target
            ? "Нет нормы"
            : entries.length === 0
              ? "Ничего не записано"
              : `${eaten.kcal} из ${target.calories} ккал`
        }
        big={Boolean(target) && entries.length > 0}
        tone="plain"
        hint={
          !target
            ? "Заполни профиль — рост, вес, возраст и цель"
            : entries.length === 0
              ? `Норма на день — ${target.calories} ккал и ${target.proteinG} г белка`
              : `Белок ${Math.round(eaten.protein)} из ${target.proteinG} г · осталось ${Math.max(
                  0,
                  target.calories - eaten.kcal,
                )} ккал`
        }
      />

      <Card
        name="Creker"
        onPress={() => onOpen("screen")}
        value={screenKnown ? formatCompact(screenMs) : access ? "Пока ноль" : "Нет доступа"}
        big={screenKnown}
        tone={overLimit ? "over" : "plain"}
        hint={
          !screenKnown
            ? access
              ? "Сегодня экран ещё не включали — или приложение только что поставили"
              : "Считать нечем, пока Android не разрешил — включается в разделе"
            : `${unlocks} ${plural(unlocks, [
                "разблокировка",
                "разблокировки",
                "разблокировок",
              ])}${limit > 0 ? ` · лимит ${formatCompact(limit * 60_000)}` : ""}`
        }
      />

      {/* Внизу и мелким: главная отвечает про сегодня, а «сегодня» — это не вся правда.
          Строчка напоминает, что за ней есть история, и не притворяется числом. */}
      <Text style={styles.footnote}>
        Здесь только сегодняшний день. История, графики и разбор — внутри разделов.
      </Text>
    </ScrollView>
  );
}

/**
 * Строка раздела.
 *
 * Цветом отмечается только то, что человек и так хотел узнать: зелёным — что привычки на
 * сегодня закрыты, тёплым — что экран перешагнул лимит. Всё остальное обычным цветом:
 * подсветить каждое число значит не подсветить ни одного.
 */
function Card({
  name,
  value,
  hint,
  big,
  tone,
  onPress,
}: {
  name: string;
  value: string;
  hint: string;
  big: boolean;
  tone: "plain" | "done" | "over";
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${value}. ${hint}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <Text style={styles.name}>{name}</Text>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </View>
      <Text
        style={[
          big ? styles.value : styles.valueSmall,
          tone === "done" && styles.done,
          tone === "over" && styles.over,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.hint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  date: { color: colors.textMuted, fontSize: 12 },
  lead: { color: colors.text, fontSize: 15, fontWeight: "500", marginTop: 2, marginBottom: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  pressed: { opacity: 0.75 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: colors.textMuted, fontSize: 12 },
  value: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "600",
    marginTop: 6,
    fontVariant: ["tabular-nums"],
  },
  valueSmall: { color: colors.text, fontSize: 15, fontWeight: "500", marginTop: 6 },
  done: { color: colors.accentGreen },
  over: { color: colors.accent },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
});
