import { useEffect } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, withAlpha } from "../theme/colors";
import { plural } from "../lib/plural";
import { useTodayKey } from "../lib/useTodayKey";
import { formatDayLong } from "../lib/date";
import { useStreak } from "../lib/useStreak";
import { dayProgress, habitsThatDecideTheDay } from "../lib/habits";
import { phaseStepFor } from "../lib/phase";
import { sumNutrition, type FoodEntry } from "../lib/balance/food";
import { targets, type Profile } from "../lib/balance/profile";
import { formatWater, waterFor, waterTarget, type WaterDay } from "../lib/balance/water";
import { totalScreenMillis, totalUnlocks, type ScreenDay } from "../lib/screen/usage";
import { formatCompact } from "../lib/screen/duration";
import { hasUsageAccess } from "../../modules/creker-usage";
import { syncUsage } from "../integrations/usageSync";
import RotatingTip from "../components/RotatingTip";
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
  const { data: waterLog = [] } = useQuery<WaterDay[]>({
    queryKey: ["waterLog"],
    queryFn: () => api.getWaterLog(),
  });
  const eaten = sumNutrition(entries);
  const target = profile ? targets(profile) : null;
  const drunk = waterFor(waterLog, today);
  const waterGoal = profile ? waterTarget(profile) : 0;

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
        icon="check-square"
        onPress={() => onOpen("sterzhen")}
        fraction={noHabits ? 0 : done / deciding.length}
        tone={allDone ? "done" : "plain"}
        value={noHabits ? "Пока пусто" : `${done} из ${deciding.length}`}
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
        icon="pie-chart"
        onPress={() => onOpen("balance")}
        fraction={target ? eaten.kcal / target.calories : 0}
        tone={target && eaten.kcal > target.calories ? "over" : "plain"}
        value={
          !target
            ? "Нет нормы"
            : entries.length === 0
              ? "Ничего не записано"
              : `${eaten.kcal} из ${target.calories} ккал`
        }
        big={Boolean(target) && entries.length > 0}
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
        // Вода отдельной строкой, а не в конце первой: это другой счёт, у него своя норма,
        // и он должен читаться даже когда про еду сказать ещё нечего.
        extra={
          waterGoal > 0
            ? `Вода ${formatWater(drunk)} из ${formatWater(waterGoal)}`
            : drunk > 0
              ? `Вода ${formatWater(drunk)}`
              : null
        }
      />

      <Card
        name="Creker"
        icon="smartphone"
        onPress={() => onOpen("screen")}
        fraction={limit > 0 ? screenMs / (limit * 60_000) : 0}
        tone={overLimit ? "over" : "plain"}
        value={screenKnown ? formatCompact(screenMs) : access ? "Пока ноль" : "Нет доступа"}
        big={screenKnown}
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

      {/* Подсказка живёт здесь, и только здесь: главную открывают каждый раз, и это
          единственное на экране, что не является числом про тебя. */}
      <RotatingTip />

      {/* Внизу и мелким: главная отвечает про сегодня, а «сегодня» — это не вся правда.
          Строчка напоминает, что за ней есть история, и не притворяется числом. */}
      <Text style={styles.footnote}>
        Здесь только сегодняшний день. История, графики и разбор — внутри разделов.
      </Text>
    </ScrollView>
  );
}

const RING = 46;
const RING_STROKE = 4;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Строка раздела: кольцо, число, пояснение.
 *
 * Кольцо показывает долю от того, что у раздела и есть мера дня, — закрытые привычки,
 * съеденная норма, лимит экрана. Три текстовые строки подряд читаются как список, а не как
 * картина дня; кольцо возвращает то, ради чего на экран смотрят, — «сколько уже».
 *
 * Цвет по состоянию, а не по разделу: зелёное — идёт как надо, тёплое — просит внимания
 * (норма превышена, экран перешагнул лимит). Разделы своими цветами не метятся: подсветить
 * каждое число значит не подсветить ни одного, а трёх осмысленных цветов у палитры и нет —
 * синий занят фокус-сессиями.
 */
function Card({
  name,
  icon,
  value,
  hint,
  extra = null,
  big,
  tone,
  fraction,
  onPress,
}: {
  name: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  value: string;
  hint: string;
  /** Вторая строка пояснения — для того, что считается отдельно от главного числа. */
  extra?: string | null;
  big: boolean;
  tone: "plain" | "done" | "over";
  /** Доля дня, закрытая этим разделом. Больше единицы кольцо не рисует. */
  fraction: number;
  onPress: () => void;
}) {
  const tint = tone === "over" ? colors.accent : colors.accentGreen;
  const filled = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${value}. ${hint}${extra ? `. ${extra}` : ""}`}
      style={({ pressed }) => [
        styles.card,
        tone === "over" && { borderColor: withAlpha(colors.accent, 0.35) },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.ring}>
        <Svg width={RING} height={RING} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            stroke={colors.cardBorder}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          {filled > 0 && (
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={RING_R}
              stroke={tint}
              strokeWidth={RING_STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${RING_C} ${RING_C}`}
              strokeDashoffset={RING_C * (1 - filled)}
            />
          )}
        </Svg>
        <View style={styles.ringIcon}>
          <Feather name={icon} size={16} color={filled > 0 ? tint : colors.textMuted} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{name}</Text>
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
        {extra && <Text style={styles.hint}>{extra}</Text>}
      </View>

      <Feather name="chevron-right" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  date: { color: colors.textMuted, fontSize: 12 },
  lead: { color: colors.text, fontSize: 15, fontWeight: "500", marginTop: 2, marginBottom: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  pressed: { opacity: 0.75 },
  ring: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  ringIcon: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  name: { color: colors.textMuted, fontSize: 12 },
  value: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  valueSmall: { color: colors.text, fontSize: 15, fontWeight: "500", marginTop: 2 },
  done: { color: colors.accentGreen },
  over: { color: colors.accent },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
});
