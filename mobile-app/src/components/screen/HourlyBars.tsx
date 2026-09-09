import { View, Text, StyleSheet } from "react-native";
import { colors } from "../../theme/colors";
import { formatAxisTick, formatCompact } from "../../lib/screen/duration";
import type { HourlyValue } from "../../lib/screen/sessions";

const HEIGHT = 110;

/**
 * Час за часом внутри одного дня.
 *
 * Единственная разбивка, которая что-то значит на однодневном периоде: сутки одним столбиком
 * не говорят ничего, а «два часа пришлись на вечер» и «два часа размазаны по рабочему дню» —
 * это разные дни при одинаковом итоге.
 *
 * Подписаны только каждые шесть часов: двадцать четыре подписи на ширине телефона
 * превращаются в серую полосу.
 */
export default function HourlyBars({ hours, counts }: { hours: HourlyValue[]; counts?: boolean }) {
  const max = hours.reduce((m, h) => Math.max(m, h.value), 0);
  const axisMax = max > 0 ? max : counts ? 1 : 60 * 60 * 1000;
  const label = (value: number) => (counts ? `${Math.round(value)}` : formatAxisTick(value, axisMax));

  return (
    <View style={styles.plot}>
      <View style={styles.axis}>
        <Text style={styles.axisTick}>{label(axisMax)}</Text>
        <Text style={styles.axisTick}>{label(axisMax / 2)}</Text>
        <Text style={styles.axisTick}>{label(0)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.bars}>
          {hours.map((h) => (
            <View
              key={h.hour}
              style={styles.slot}
              accessibilityLabel={`${h.hour}:00 — ${counts ? h.value : formatCompact(h.value)}`}
            >
              <View style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(h.value > 0 ? 2 : 0, (h.value / axisMax) * HEIGHT) },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.ticks}>
          {[0, 6, 12, 18].map((hour) => (
            <Text key={hour} style={styles.tick}>{`${hour}:00`}</Text>
          ))}
          <Text style={styles.tick}>24</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: "row", gap: 8 },
  axis: { height: HEIGHT, justifyContent: "space-between", alignItems: "flex-end", minWidth: 26 },
  axisTick: { color: colors.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  slot: { flex: 1 },
  track: { height: HEIGHT, width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 2, backgroundColor: colors.accentGreen, opacity: 0.8 },
  ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  tick: { color: colors.textMuted, fontSize: 9 },
});
