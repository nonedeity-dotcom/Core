import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../../theme/colors";
import { formatAxisTick, formatCompact } from "../../lib/screen/duration";
import { weekdayLabel } from "../../lib/date";

/** Один столбик: день и сколько в нём. */
export interface Bar {
  date: string;
  value: number;
}

const HEIGHT = 120;

/**
 * Столбики по дням.
 *
 * Рисуются обычными View, а не через SVG: это прямоугольники, и слой векторной графики для
 * прямоугольников — лишний. Подпись оси берётся в одной единице на всю ось, как в creker:
 * ось с потолком в полчаса не должна выходить «30м / 15м / 0с».
 */
export default function UsageBars({
  bars,
  selected,
  onSelect,
}: {
  bars: Bar[];
  selected?: string | null;
  onSelect?: (date: string) => void;
}) {
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0);
  // Пустой период — не повод рисовать нулевую высоту у всех: ось всё равно нужна.
  const axisMax = max > 0 ? max : 60 * 60 * 1000;
  // Не больше подписей, чем влезет: на месяце каждая пятая, на неделе каждая.
  const labelEvery = bars.length > 14 ? Math.ceil(bars.length / 6) : 1;

  return (
    <View>
      <View style={styles.plot}>
        <View style={styles.axis}>
          <Text style={styles.axisTick}>{formatAxisTick(axisMax, axisMax)}</Text>
          <Text style={styles.axisTick}>{formatAxisTick(axisMax / 2, axisMax)}</Text>
          <Text style={styles.axisTick}>{formatAxisTick(0, axisMax)}</Text>
        </View>
        <View style={styles.bars}>
          {bars.map((bar, i) => {
            const share = axisMax > 0 ? bar.value / axisMax : 0;
            const on = selected === bar.date;
            return (
              <Pressable
                key={bar.date}
                onPress={() => onSelect?.(bar.date)}
                disabled={!onSelect}
                accessibilityRole={onSelect ? "button" : undefined}
                accessibilityLabel={`${bar.date}: ${formatCompact(bar.value)}`}
                style={styles.barSlot}
              >
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      { height: Math.max(bar.value > 0 ? 2 : 0, share * HEIGHT) },
                      on && styles.barOn,
                    ]}
                  />
                </View>
                <Text style={[styles.tick, on && styles.tickOn]} numberOfLines={1}>
                  {i % labelEvery === 0 ? weekdayLabel(bar.date) : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: "row", gap: 8 },
  axis: { height: HEIGHT, justifyContent: "space-between", alignItems: "flex-end", minWidth: 26 },
  axisTick: { color: colors.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },
  bars: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  barSlot: { flex: 1, alignItems: "center" },
  barTrack: { height: HEIGHT, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 3, backgroundColor: colors.accentGreen, opacity: 0.75 },
  barOn: { opacity: 1, backgroundColor: colors.accent },
  tick: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  tickOn: { color: colors.text },
});
