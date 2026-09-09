import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { colors, withAlpha } from "../../theme/colors";
import { formatAxisTick, formatCompact, formatWithUnits } from "../../lib/screen/duration";

/** Одна точка графика: чем подписана снизу и сколько в ней. */
export interface ChartPoint {
  key: string;
  label: string;
  value: number;
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

/**
 * График по точкам — столбиками или линией.
 *
 * Два вида не украшение: столбики отвечают «сколько в этот час», линия — «как оно шло», и
 * на сутках это разные вопросы. Один компонент на оба, потому что ось, запас сверху,
 * прокрутка и выбор точки у них общие, а расходятся они ровно в том, чем рисовать.
 *
 * Числа показываются по-разному, и тоже не от лени: над столбиком число помещается и стоит
 * там всегда, а над точкой линии оно налезло бы на соседние, поэтому линия отдаёт своё
 * число по нажатию.
 *
 * Когда точки не помещаются, график прокручивается вбок, а ось остаётся на месте: двадцать
 * четыре часа, втиснутые в ширину телефона, — это не график, а полоска.
 */
export default function ValueChart({
  points,
  kind,
  counts = false,
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  kind: ChartKind;
  /** Значения — штуки, а не миллисекунды: подписи числом, а не «2ч». */
  counts?: boolean;
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  const [width, setWidth] = useState(0);
  // Своя отметка — для случая, когда родитель выбором не занимается. Если занимается, он же
  // и показывает, что выбрано, и второй подписи быть не должно.
  const [touched, setTouched] = useState<string | null>(null);
  const owns = !onSelect;
  const active = owns ? touched : (selected ?? null);

  const max = points.reduce((m, p) => Math.max(m, p.value), 0);
  const axisMax = max > 0 ? max : counts ? 1 : 60 * 60 * 1000;
  const tick = (value: number) => (counts ? `${Math.round(value)}` : formatAxisTick(value, axisMax));
  const say = (value: number) => (counts ? `${Math.round(value)}` : formatCompact(value));

  const contentWidth = Math.max(width, points.length * MIN_STEP);
  const scrolls = contentWidth > width + 1;
  const press = (key: string) => (owns ? setTouched(key === touched ? null : key) : onSelect?.(key));
  const shown = active ? points.find((p) => p.key === active) : undefined;

  const body = (
    <View style={{ width: contentWidth }}>
      {kind === "bars" ? (
        <Bars points={points} axisMax={axisMax} say={say} active={active} onPress={press} />
      ) : (
        <Line points={points} axisMax={axisMax} width={contentWidth} active={active} onPress={press} />
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
            ? `${shown.label} — ${counts ? `${Math.round(shown.value)}` : exact(shown.value)}`
            : kind === "line"
              ? "Нажми на точку, чтобы увидеть время"
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

function Bars({
  points,
  axisMax,
  say,
  active,
  onPress,
}: {
  points: ChartPoint[];
  axisMax: number;
  say: (value: number) => string;
  active: string | null;
  onPress: (key: string) => void;
}) {
  return (
    <View style={styles.bars}>
      {points.map((p) => {
        const on = active === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => onPress(p.key)}
            accessibilityRole="button"
            accessibilityLabel={`${p.label}: ${say(p.value)}`}
            style={styles.slot}
          >
            {/* Ноль не подписывается: два десятка нулей над пустыми столбиками — это шум,
                а не данные, и они заслоняют те подписи, ради которых сюда смотрят. */}
            <Text style={[styles.barValue, on && styles.barValueOn]} numberOfLines={1}>
              {p.value > 0 ? say(p.value) : ""}
            </Text>
            <View
              style={[
                styles.bar,
                { height: Math.max(p.value > 0 ? 2 : 0, (p.value / axisMax) * HEIGHT) },
                on && styles.barOn,
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Линия с заливкой под ней и точкой на каждом значении.
 *
 * Заливка — не декор: без неё линия на тёмном фоне читается как проволока, и глазу не за
 * что зацепиться, чтобы понять, где у графика низ.
 */
function Line({
  points,
  axisMax,
  width,
  active,
  onPress,
}: {
  points: ChartPoint[];
  axisMax: number;
  width: number;
  active: string | null;
  onPress: (key: string) => void;
}) {
  const total = HEIGHT + PAD_TOP;
  const step = points.length > 1 ? width / points.length : width;
  const x = (i: number) => step * i + step / 2;
  const y = (value: number) => PAD_TOP + HEIGHT - (value / axisMax) * HEIGHT;
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  // Замкнуть площадь по нижнему краю: полигон должен опираться на ось, а не висеть.
  const area = `${x(0)},${total} ${line} ${x(points.length - 1)},${total}`;

  return (
    <View style={{ height: total }}>
      <Svg width={width} height={total}>
        {points.length > 1 && (
          <>
            <Polygon points={area} fill={withAlpha(colors.accentGreen, 0.16)} />
            <Polyline
              points={line}
              fill="none"
              stroke={colors.accentGreen}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}
        {points.map((p, i) => (
          <Circle
            key={p.key}
            cx={x(i)}
            cy={y(p.value)}
            r={active === p.key ? 5 : 2.5}
            fill={active === p.key ? colors.accent : colors.accentGreen}
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
              accessibilityLabel={`${p.label}: ${formatCompact(p.value)}`}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: colors.textMuted,
    fontSize: 8.5,
    textAlign: "center",
    marginBottom: 2,
    fontVariant: ["tabular-nums"],
  },
  barValueOn: { color: colors.text, fontWeight: "600" },
  bar: { width: "100%", borderRadius: 3, backgroundColor: colors.accentGreen, opacity: 0.8 },
  barOn: { opacity: 1, backgroundColor: colors.accent },
  ticks: { flexDirection: "row", marginTop: 5 },
  tick: { flex: 1, textAlign: "center", color: colors.textMuted, fontSize: 9 },
  tickOn: { color: colors.text, fontWeight: "600" },
  readout: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginTop: 8, minHeight: 15 },
});
