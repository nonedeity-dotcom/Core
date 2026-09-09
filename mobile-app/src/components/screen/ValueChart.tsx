import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { colors, withAlpha } from "../../theme/colors";
import { formatAxisTick, formatCompact } from "../../lib/screen/duration";

/** Одна точка графика: чем подписана снизу и сколько в ней. */
export interface ChartPoint {
  key: string;
  label: string;
  value: number;
}

export type ChartKind = "bars" | "line";

const HEIGHT = 130;
/** Минимальная ширина точки. Уже — и подписи сливаются в серую полосу. */
const MIN_STEP = 30;

/**
 * График по точкам — столбиками или линией.
 *
 * Два вида не украшение: столбики отвечают «сколько в этот час», линия — «как оно шло», и
 * на сутках это разные вопросы. Один компонент на оба, потому что ось, прокрутка и выбор
 * точки у них общие, а расходятся они ровно в том, чем рисовать.
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
  /** Значения — штуки, а не миллисекунды: ось подписывается числом, а не «2ч». */
  counts?: boolean;
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const max = points.reduce((m, p) => Math.max(m, p.value), 0);
  const axisMax = max > 0 ? max : counts ? 1 : 60 * 60 * 1000;
  const tick = (value: number) => (counts ? `${Math.round(value)}` : formatAxisTick(value, axisMax));

  const contentWidth = Math.max(width, points.length * MIN_STEP);
  const scrolls = contentWidth > width + 1;

  const body = (
    <View style={{ width: contentWidth }}>
      {kind === "bars" ? (
        <Bars points={points} axisMax={axisMax} counts={counts} selected={selected} onSelect={onSelect} />
      ) : (
        <Line points={points} axisMax={axisMax} width={contentWidth} selected={selected} onSelect={onSelect} />
      )}
      <View style={styles.ticks}>
        {points.map((p) => (
          <Text key={p.key} style={[styles.tick, selected === p.key && styles.tickOn]} numberOfLines={1}>
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );

  return (
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
  );
}

function Bars({
  points,
  axisMax,
  counts,
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  axisMax: number;
  counts: boolean;
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  return (
    <View style={styles.bars}>
      {points.map((p) => {
        const on = selected === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => onSelect?.(p.key)}
            disabled={!onSelect}
            accessibilityRole={onSelect ? "button" : undefined}
            accessibilityLabel={`${p.label}: ${counts ? p.value : formatCompact(p.value)}`}
            style={styles.slot}
          >
            <View style={styles.track}>
              <View
                style={[
                  styles.bar,
                  { height: Math.max(p.value > 0 ? 2 : 0, (p.value / axisMax) * HEIGHT) },
                  on && styles.barOn,
                ]}
              />
            </View>
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
  selected,
  onSelect,
}: {
  points: ChartPoint[];
  axisMax: number;
  width: number;
  selected?: string | null;
  onSelect?: (key: string) => void;
}) {
  const step = points.length > 1 ? width / points.length : width;
  const x = (i: number) => step * i + step / 2;
  const y = (value: number) => HEIGHT - (value / axisMax) * HEIGHT;
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  // Замкнуть площадь по нижнему краю: полигон должен опираться на ось, а не висеть.
  const area = `${x(0)},${HEIGHT} ${line} ${x(points.length - 1)},${HEIGHT}`;

  return (
    <View style={{ height: HEIGHT }}>
      <Svg width={width} height={HEIGHT}>
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
            r={selected === p.key ? 4.5 : 2.5}
            fill={selected === p.key ? colors.accent : colors.accentGreen}
          />
        ))}
      </Svg>
      {/* Нажатия ловит отдельный слой поверх картинки: у SVG-фигур на вебе нет своих. */}
      {onSelect && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={{ flexDirection: "row", height: HEIGHT }}>
            {points.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => onSelect(p.key)}
                accessibilityRole="button"
                accessibilityLabel={`${p.label}: ${formatCompact(p.value)}`}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: "row", gap: 8 },
  axis: { height: HEIGHT, justifyContent: "space-between", alignItems: "flex-end", minWidth: 28 },
  axisTick: { color: colors.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },
  bars: { flexDirection: "row", alignItems: "flex-end", height: HEIGHT },
  slot: { flex: 1, paddingHorizontal: 1.5 },
  track: { height: HEIGHT, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 3, backgroundColor: colors.accentGreen, opacity: 0.8 },
  barOn: { opacity: 1, backgroundColor: colors.accent },
  ticks: { flexDirection: "row", marginTop: 5 },
  tick: { flex: 1, textAlign: "center", color: colors.textMuted, fontSize: 9 },
  tickOn: { color: colors.text, fontWeight: "600" },
});
