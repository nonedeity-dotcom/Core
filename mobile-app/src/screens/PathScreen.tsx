import { useState } from "react";
import { View, Text, ScrollView, StyleSheet, type LayoutChangeEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, withAlpha } from "../theme/colors";
import { plural } from "../lib/plural";
import { formatDayLong } from "../lib/date";
import { formatMinutes } from "../lib/stats";
import { usePath } from "../lib/path/usePath";
import type { DayMark, YearDay } from "../lib/path/year";
import type { EarnedTitle, TitleRule } from "../lib/rewards/catalog";

/**
 * Зазор между клетками.
 *
 * Сама клетка не задаётся числом: пятьдесят три недели должны влезть в ширину экрана, а
 * ширина у телефонов разная. Записанный размер подошёл бы одному и вылез бы у другого,
 * поэтому клетка считается из того, сколько места дали.
 */
const GAP = 1;
/** Меньше трёх точек клетка перестаёт быть клеткой. */
const MIN_CELL = 3;

/**
 * Цвет клетки.
 *
 * Зелёный — закрытый день, и он один яркий: на решётке из трёхсот семидесяти клеток глаз
 * должен находить сделанное, а не разбирать шесть оттенков. Всё остальное приглушено до
 * фона разной плотности, и это намеренно: промах не выделяется красным. Красная сетка
 * провалов — ровно то, из-за чего такие экраны закрывают и не открывают больше.
 */
const MARK_COLORS: Record<DayMark, string> = {
  closed: colors.accentGreen,
  today: withAlpha(colors.accentGreen, 0.35),
  frozen: withAlpha(colors.blue, 0.45),
  off: withAlpha(colors.textMuted, 0.3),
  missed: colors.cardBorder,
  before: "transparent",
  future: "transparent",
};

/**
 * «Путь» — приложение показывает не сегодня, а тебя целиком.
 *
 * Всё остальное здесь отвечает про день и про месяц. Этот экран — единственный, который
 * отвечает про всё время сразу: сколько ты здесь, сколько из этого получилось, где рвалось
 * и что осталось после. Ничего нового он не считает и ничего не начисляет — только
 * собирает в одно место то, что уже разбросано по разделам.
 */
export default function PathScreen({
  titles,
  next,
}: {
  /** Титулы — от начисления, а не свои: иначе у соседних вкладок профиля разные ответы. */
  titles: EarnedTitle[];
  next: { rule: TitleRule; have: number; need: number } | null;
}) {
  const path = usePath();

  if (!path.ready) return <View style={styles.container} />;

  if (path.since === null) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.empty}>
          Пути пока нет — он начнётся с первой отметки. Отметь сегодня хоть одну привычку, и
          здесь появится первая клетка.
        </Text>
      </ScrollView>
    );
  }

  const { streak, grid, focus, goals, games, care } = path;
  const share = path.days > 0 ? Math.round((path.closedDays / path.days) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.since}>
        {`Здесь с ${formatDayLong(path.since)} ${path.since.slice(0, 4)} — это ${path.days} ${plural(path.days, [
          "день",
          "дня",
          "дней",
        ])}`}
      </Text>

      <View style={styles.bigRow}>
        <Big value={path.closedDays} label={plural(path.closedDays, ["закрытый день", "закрытых дня", "закрытых дней"])} tint={colors.accentGreen} />
        <Big value={streak.best} label="лучшая серия" tint={colors.accent} />
        <Big value={streak.current} label="сейчас подряд" tint={colors.text} />
      </View>
      <Text style={styles.note}>
        {`Из ${path.days} ${plural(path.days, ["дня", "дней", "дней"])} получилось ${share}%. Серия начиналась заново ${
          streak.restarts
        } ${plural(streak.restarts, ["раз", "раза", "раз"])}${
          streak.average > 0 ? `, средняя длина — ${streak.average}` : ""
        }.`}
      </Text>

      <Text style={[styles.sectionLabel, styles.spaced]}>Год клетками</Text>
      {/* Решётка вылезает в поля экрана: пятьдесят три колонки делят ширину между собой, и
          каждые десять точек отступа — это минус точка с клетки, то есть минус пятая часть
          её размера. Текст вокруг остаётся на своём месте. */}
      <View style={styles.bleed}>
        <Year grid={grid} />
      </View>
      <View style={styles.legend}>
        <Dot mark="closed" label="закрыт" />
        <Dot mark="missed" label="пропуск" />
        <Dot mark="off" label="выходной" />
        <Dot mark="frozen" label="заморозка" />
      </View>
      <Text style={styles.note}>
        Слева направо — недели, правый столбец — эта неделя; сверху вниз — с понедельника по
        воскресенье. Промахи не красные намеренно: сетка укоров — это то, что закрывают и
        больше не открывают.
      </Text>

      <Text style={[styles.sectionLabel, styles.spaced]}>Этапы дороги</Text>
      {path.phases.map(({ step, reached }) => (
        <View key={step.id} style={[styles.row, reached && styles.rowOn]}>
          <Feather
            name={reached ? "check-circle" : "circle"}
            size={16}
            color={reached ? colors.accentGreen : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, !reached && styles.rowTitleOff]}>{step.title}</Text>
            <Text style={styles.rowHint}>{`${step.range} · ${step.short}`}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.note}>
        Этап засчитан по лучшей серии, а не по нынешней: дойти до «ямы» и сорваться — это всё
        равно дойти.
      </Text>

      <Text style={[styles.sectionLabel, styles.spaced]}>Что ещё было</Text>
      <Line
        icon="target"
        text={
          focus.sessions > 0
            ? `${focus.sessions} ${plural(focus.sessions, [
                "фокус-сессия",
                "фокус-сессии",
                "фокус-сессий",
              ])} · ${formatMinutes(focus.minutes)}`
            : "Фокус-сессий пока не было"
        }
      />
      <Line
        icon="flag"
        text={
          goals.planned > 0
            ? `${goals.planned} ${plural(goals.planned, [
                "месяц с целью",
                "месяца с целью",
                "месяцев с целью",
              ])} · закрыто целиком ${goals.done} · итогов написано ${goals.summaries}`
            : "Целей на месяц пока не ставилось"
        }
      />
      <Line
        icon="grid"
        text={
          games.fields > 0
            ? `${games.fields} ${plural(games.fields, ["поле", "поля", "полей"])} в словах · на сложном ${
                games.hard
              } · рекордов ${games.records}`
            : "Полей в словах пока не собрано"
        }
      />

      {/* CaloriX и Creker — одной строкой каждый: в «Пути» важно, что они вообще были. */}
      {(care.mealDays > 0 || care.weights > 0) && (
        <Line
          icon="pie-chart"
          text={`${care.mealDays} ${plural(care.mealDays, [
            "день",
            "дня",
            "дней",
          ])} с записанной едой · взвешиваний ${care.weights}`}
        />
      )}
      {care.screenDays > 0 && (
        <Line
          icon="smartphone"
          text={`${care.screenDays} ${plural(care.screenDays, [
            "день",
            "дня",
            "дней",
          ])} в пределах экранного лимита`}
        />
      )}

      <Text style={[styles.sectionLabel, styles.spaced]}>Титулы</Text>
      {titles.length === 0 ? (
        <Text style={styles.note}>Пока ни одного — они выдаются сами, за то, что случилось.</Text>
      ) : (
        <View style={styles.titleRow}>
          {titles.map((t) => (
            <View key={t.id} style={styles.badge}>
              <Feather name="award" size={12} color={colors.accentGreen} />
              <Text style={styles.badgeText}>{t.title}</Text>
            </View>
          ))}
        </View>
      )}
      {next !== null && (
        <Text style={styles.note}>
          {`Ближе всего «${next.rule.title}»: ${next.have} из ${next.need}, осталось ${next.need - next.have}.`}
        </Text>
      )}

      <Text style={styles.footnote}>
        Здесь ничего не начисляется и не тратится — это только зеркало. Монеты и магазин
        живут в «Наградах».
      </Text>
    </ScrollView>
  );
}

/**
 * Решётка.
 *
 * Подписей дней недели слева нет, и это не забывчивость. Строка здесь ростом в пять точек,
 * а читаемая подпись — в восемь: они налезали друг на друга и превращались в серую кашу.
 * Подпись, которую нельзя прочитать, — это не подпись, а шум; что строки идут с
 * понедельника, сказано словами под решёткой.
 *
 * Ширина меряется по факту, а размер клетки считается из неё: у телефонов она разная, и
 * записанный числом размер подошёл бы одному и вылез бы у другого. Пока не померили,
 * решётки нет вовсе — нарисовать наугад и переложить на следующем кадре значит дёрнуть
 * половину экрана.
 */
function Year({ grid }: { grid: ReturnType<typeof usePath>["grid"] }) {
  const [cell, setCell] = useState(0);
  const weeks = grid.weeks.length;

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.max(MIN_CELL, Math.floor((e.nativeEvent.layout.width - (weeks - 1) * GAP) / weeks));
    if (next !== cell) setCell(next);
  };

  const step = cell + GAP;

  return (
    <View onLayout={onLayout}>
      {cell > 0 && (
        // Ширина по клеткам, а не по месту: остаток в несколько точек уходит в поля, а не
        // растягивает последний столбец.
        <View style={{ width: weeks * step - GAP, alignSelf: "center" }}>
          {/* Подписи месяцев — строкой над решёткой, каждая на своей колонке. */}
          <View style={styles.monthRow}>
            {grid.months.map((m) => (
              <Text key={`${m.column}:${m.label}`} style={[styles.monthLabel, { left: m.column * step }]}>
                {m.label}
              </Text>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: GAP }}>
            {grid.weeks.map((week, i) => (
              <View key={i} style={{ gap: GAP }}>
                {week.map((day) => (
                  <Cell key={day.date} day={day} size={cell} />
                ))}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function Cell({ day, size }: { day: YearDay; size: number }) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: 1, backgroundColor: MARK_COLORS[day.mark] },
        day.mark === "today" && styles.cellToday,
      ]}
      accessibilityLabel={day.mark === "closed" ? `${day.date}: закрыт` : undefined}
    />
  );
}

function Dot({ mark, label }: { mark: DayMark; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: MARK_COLORS[mark] }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Big({ value, label, tint }: { value: number; label: string; tint: string }) {
  return (
    <View style={styles.big}>
      <Text style={[styles.bigValue, { color: tint }]}>{value}</Text>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

function Line({ icon, text }: { icon: React.ComponentProps<typeof Feather>["name"]; text: string }) {
  return (
    <View style={styles.row}>
      <Feather name={icon} size={16} color={colors.textMuted} />
      <Text style={styles.lineText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  empty: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  since: { color: colors.textMuted, fontSize: 12, marginBottom: 14 },

  bigRow: { flexDirection: "row", gap: 10 },
  big: { flex: 1, backgroundColor: colors.card, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 12 },
  bigValue: { fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
  bigLabel: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 4 },

  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 24 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 24 },

  bleed: { marginHorizontal: -10 },
  monthRow: { height: 12, marginBottom: 2 },
  monthLabel: { position: "absolute", color: colors.textMuted, fontSize: 9 },
  cellToday: { borderWidth: 1, borderColor: colors.accentGreen },

  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { color: colors.textMuted, fontSize: 10 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowOn: { borderWidth: 1, borderColor: "rgba(143,184,154,0.35)" },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowTitleOff: { color: colors.textMuted },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  lineText: { color: colors.text, fontSize: 13, flex: 1, lineHeight: 18 },

  titleRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(143,184,154,0.12)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
});
