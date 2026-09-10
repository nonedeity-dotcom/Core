import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { colors, withAlpha } from "../../theme/colors";
import { formatCompact, formatWithUnits } from "../../lib/screen/duration";

/** Одна точка графика: чем подписана снизу и что в ней — время и заходы вместе. */
export interface ChartPoint {
  key: string;
  label: string;
  /** Время, миллисекунды. */
  time: number;
  /** Заходы (у «телефона» — разблокировки), штуки. */
  launches: number;
}

export type ChartKind = "bars" | "line";

const HEIGHT = 130;
/**
 * Запас над графиком.
 *
 * Без него самая высокая точка упиралась в край: у линии срезалась половина кружка, а
 * подписи над столбиком было просто негде встать. Верх графика — это то место, ради
 * которого на него и смотрят.
 */
const PAD_TOP = 16;
/** Минимальная ширина точки. Уже — и подписи сливаются в серую полосу. */
const MIN_STEP = 34;
/** Ниже этой высоты подпись внутрь столбика не влезает — она уходит вовсе. */
const INSIDE_MIN = 13;

const MINUTE = 60 * 1000;
/** Время на общей шкале считается минутами — в них же подписана ось. */
const minutes = (time: number): number => time / MINUTE;

/**
 * График по точкам: время и заходы вместе, столбиками или линией.
 *
 * Раньше это были два графика за одним переключателем, и чтобы сравнить «долго сидел» с
 * «часто брался», приходилось нажимать туда-сюда и держать первое в голове. Теперь они на
 * одной картинке: столбик — время, надстройка над ним — заходы. Час, где 57 минут набраны
 * одним заходом, и час, где те же 57 минут набраны сотней, — это две разные жизни, и
 * видно их только рядом.
 *
 * Шкала одна на двоих, и она в минутах: заходы кладутся на неё как есть, штука за минуту.
 * Общая высота столбика поэтому ничего не значит и нигде не подписана — значат его части,
 * и у каждой своё число своим цветом.
 *
 * Два вида не украшение: столбики отвечают «сколько в этот час», линия — «как оно шло», и
 * на сутках это разные вопросы. Один компонент на оба, потому что ось, запас сверху,
 * прокрутка и выбор точки у них общие, а расходятся они ровно в том, чем рисовать.
 *
 * Когда точки не помещаются, график прокручивается вбок, а ось остаётся на месте: двадцать
 * четыре часа, втиснутые в ширину телефона, — это не график, а полоска.
 */
export default function ValueChart({
  points,
  kind,
  /** Как называть заходы в подписях: у «телефона» это разблокировки. */
  countWord = "заходы",
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  kind: ChartKind;
  countWord?: string;
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  const [width, setWidth] = useState(0);
  // Своя отметка — для случая, когда родитель выбором не занимается. Если занимается, он же
  // и показывает, что выбрано, и второй подписи быть не должно.
  const [touched, setTouched] = useState<string | null>(null);
  const owns = !onSelect;
  const active = owns ? touched : (selected ?? null);

  const max = points.reduce((m, p) => Math.max(m, minutes(p.time) + p.launches), 0);
  const axisMax = max > 0 ? max : 60;
  const tick = (value: number) => `${Math.round(value)}`;

  const contentWidth = Math.max(width, points.length * MIN_STEP);
  const scrolls = contentWidth > width + 1;
  const press = (key: string) => (owns ? setTouched(key === touched ? null : key) : onSelect?.(key));
  const shown = active ? points.find((p) => p.key === active) : undefined;

  const body = (
    <View style={{ width: contentWidth }}>
      {kind === "bars" ? (
        <Bars points={points} axisMax={axisMax} active={active} onPress={press} countWord={countWord} />
      ) : (
        <Line
          points={points}
          axisMax={axisMax}
          width={contentWidth}
          active={active}
          onPress={press}
          countWord={countWord}
        />
      )}
      <View style={styles.ticks}>
        {points.map((p) => (
          <Text key={p.key} style={[styles.tick, active === p.key && styles.tickOn]} numberOfLines={1}>
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );

  return (
    <View>
      {/* Без пояснения два цвета — просто два цвета. С ним они читаются с первого взгляда
          и больше объяснений не требуют. */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.accentGreen }]} />
          <Text style={styles.legendText}>Время (мин)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>{countWord[0].toUpperCase() + countWord.slice(1)}</Text>
        </View>
      </View>

      <View style={styles.plot}>
        <View style={styles.axis}>
          <Text style={styles.axisTick}>{tick(axisMax)}</Text>
          <Text style={styles.axisTick}>{tick(axisMax / 2)}</Text>
          <Text style={styles.axisTick}>{tick(0)}</Text>
        </View>
        <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 &&
            (scrolls ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {body}
              </ScrollView>
            ) : (
              body
            ))}
        </View>
      </View>

      {/* Своя подпись — только когда выбором не занят родитель. Место под неё держится
          всегда, иначе карточка прыгает на каждое нажатие. */}
      {owns && (
        <Text style={styles.readout} numberOfLines={1}>
          {shown
            ? `${shown.label} — ${exact(shown.time)}, ${shown.launches} ${countWord}`
            : kind === "line"
              ? "Нажми на точку, чтобы увидеть числа"
              : " "}
        </Text>
      )}
    </View>
  );
}

/**
 * Точное время для подписи под графиком.
 *
 * `formatWithUnits` всегда договаривает секунды, и ровный час выходил как «1ч 35м 0с».
 * Ноль в конце ничего не сообщает, а место занимает; при этом у коротких значений секунды
 * — единственное, что там есть, и они остаются.
 */
function exact(value: number): string {
  const full = formatWithUnits(value);
  return full.endsWith(" 0с") ? full.slice(0, -3) : full;
}

/**
 * Столбик из двух частей: время снизу, заходы сверху.
 *
 * Число заходов стоит над столбиком, число времени — внутри своей части. Обе подписи
 * пропадают, когда подписывать нечего: ноль над пустым столбиком это шум, а время,
 * которому не хватило высоты, лучше не подписать вовсе, чем налезть на соседа.
 */
function Bars({
  points,
  axisMax,
  active,
  onPress,
  countWord,
}: {
  points: ChartPoint[];
  axisMax: number;
  active: string | null;
  onPress: (key: string) => void;
  countWord: string;
}) {
  return (
    <View style={styles.bars}>
      {points.map((p) => {
        const on = active === p.key;
        const timeH = (minutes(p.time) / axisMax) * HEIGHT;
        const countH = (p.launches / axisMax) * HEIGHT;
        return (
          <Pressable
            key={p.key}
            onPress={() => onPress(p.key)}
            accessibilityRole="button"
            accessibilityLabel={`${p.label}: ${formatCompact(p.time)}, ${p.launches} ${countWord}`}
            style={styles.slot}
          >
            <Text style={[styles.barValue, on && styles.barValueOn]} numberOfLines={1}>
              {p.launches > 0 ? `${p.launches}` : ""}
            </Text>
            {p.launches > 0 && (
              <View style={[styles.barTop, { height: Math.max(2, countH) }, on && styles.barOn]} />
            )}
            <View
              style={[
                styles.bar,
                { height: Math.max(p.time > 0 ? 2 : 0, timeH) },
                p.launches > 0 && styles.barUnder,
                on && styles.barOn,
              ]}
            >
              {timeH >= INSIDE_MIN && (
                <Text style={styles.inside} numberOfLines={1}>
                  {formatCompact(p.time)}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Две линии с заливкой под временем.
 *
 * Заливка — не декор: без неё линия на тёмном фоне читается как проволока, и глазу не за
 * что зацепиться, чтобы понять, где у графика низ. Залита только одна из двух, иначе они
 * закрасили бы друг друга.
 */
function Line({
  points,
  axisMax,
  width,
  active,
  onPress,
  countWord,
}: {
  points: ChartPoint[];
  axisMax: number;
  width: number;
  active: string | null;
  onPress: (key: string) => void;
  countWord: string;
}) {
  const total = HEIGHT + PAD_TOP;
  const step = points.length > 1 ? width / points.length : width;
  const x = (i: number) => step * i + step / 2;
  const y = (value: number) => PAD_TOP + HEIGHT - (value / axisMax) * HEIGHT;
  const path = (value: (p: ChartPoint) => number) =>
    points.map((p, i) => `${x(i)},${y(value(p))}`).join(" ");
  const timeLine = path((p) => minutes(p.time));
  const countLine = path((p) => p.launches);
  // Замкнуть площадь по нижнему краю: полигон должен опираться на ось, а не висеть.
  const area = `${x(0)},${total} ${timeLine} ${x(points.length - 1)},${total}`;

  return (
    <View style={{ height: total }}>
      <Svg width={width} height={total}>
        {points.length > 1 && (
          <>
            <Polygon points={area} fill={withAlpha(colors.accentGreen, 0.16)} />
            <Polyline
              points={timeLine}
              fill="none"
              stroke={colors.accentGreen}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Polyline
              points={countLine}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
        {points.map((p, i) => (
          <Circle
            key={`t${p.key}`}
            cx={x(i)}
            cy={y(minutes(p.time))}
            r={active === p.key ? 5 : 2.5}
            fill={colors.accentGreen}
          />
        ))}
        {points.map((p, i) => (
          <Circle
            key={`c${p.key}`}
            cx={x(i)}
            cy={y(p.launches)}
            r={active === p.key ? 5 : 2.5}
            fill={colors.accent}
          />
        ))}
      </Svg>
      {/* Нажатия ловит отдельный слой поверх картинки: у SVG-фигур на вебе нет своих. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={{ flexDirection: "row", height: total }}>
          {points.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => onPress(p.key)}
              accessibilityRole="button"
              accessibilityLabel={`${p.label}: ${formatCompact(p.time)}, ${p.launches} ${countWord}`}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", gap: 14, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11 },
  plot: { flexDirection: "row", gap: 8 },
  // Верхняя подпись оси стоит на уровне потолка графика, а не выше запаса над ним.
  axis: {
    height: HEIGHT + PAD_TOP,
    paddingTop: PAD_TOP,
    justifyContent: "space-between",
    alignItems: "flex-end",
    minWidth: 28,
  },
  axisTick: { color: colors.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },
  bars: { flexDirection: "row", alignItems: "flex-end", height: HEIGHT + PAD_TOP },
  slot: { flex: 1, paddingHorizontal: 1.5, justifyContent: "flex-end" },
  barValue: {
    color: colors.accent,
    fontSize: 8.5,
    textAlign: "center",
    marginBottom: 2,
    fontVariant: ["tabular-nums"],
  },
  barValueOn: { color: colors.text, fontWeight: "600" },
  bar: {
    width: "100%",
    borderRadius: 3,
    backgroundColor: colors.accentGreen,
    opacity: 0.85,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  // Части одного столбика смыкаются: скруглять надо только внешние углы.
  barUnder: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  barTop: {
    width: "100%",
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: colors.accent,
    opacity: 0.85,
  },
  barOn: { opacity: 1 },
  inside: {
    color: colors.text,
    fontSize: 8.5,
    textAlign: "center",
    marginBottom: 3,
    fontVariant: ["tabular-nums"],
  },
  ticks: { flexDirection: "row", marginTop: 5 },
  tick: { flex: 1, textAlign: "center", color: colors.textMuted, fontSize: 9 },
  tickOn: { color: colors.text, fontWeight: "600" },
  readout: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginTop: 8, minHeight: 15 },
});
