import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, withAlpha } from "../../theme/colors";
import { formatDuration } from "../../lib/screen/duration";
import type { AppTotal } from "../../lib/screen/usage";

const SIZE = 168;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * Сколько времени в каких приложениях — кольцом.
 *
 * Перенесено из creker. Смысл кольца не в том, чтобы прочитать по нему число: числа стоят
 * списком ниже. Смысл в пропорции — видно за секунду, ушёл день в одно приложение или
 * растёкся по десятку, а это разные дни, даже когда итог одинаковый.
 */

/** Пять цветов на пять самых больших долей, остальное — одним серым куском. */
const SLICE_COLORS = [colors.accentGreen, colors.blue, colors.accent, "#a97ae0", "#f4a858"];
const REST_COLOR = colors.cardBorder;
export const RING_SLICES = SLICE_COLORS.length;

export default function UsageRing({ totals, totalMs }: { totals: AppTotal[]; totalMs: number }) {
  const top = totals.slice(0, RING_SLICES);
  const restMs = Math.max(0, totalMs - top.reduce((sum, t) => sum + t.usageMillis, 0));
  const slices = [
    ...top.map((t, i) => ({ value: t.usageMillis, color: SLICE_COLORS[i] })),
    ...(restMs > 0 ? [{ value: restMs, color: REST_COLOR }] : []),
  ];

  let offset = 0;
  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        {/* Дорожка под кольцом: пустой день должен выглядеть как пустое кольцо, а не как
            дырка в вёрстке. */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={withAlpha(colors.cardBorder, 0.6)}
          strokeWidth={STROKE}
          fill="none"
        />
        {totalMs > 0 &&
          slices.map((slice, i) => {
            const share = slice.value / totalMs;
            const dash = share * CIRC;
            const circle = (
              <Circle
                key={i}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                stroke={slice.color}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRC - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                fill="none"
                // Начинать сверху, а не справа: круг читается с двенадцати часов.
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            );
            offset += dash;
            return circle;
          })}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={styles.total}>{formatDuration(totalMs)}</Text>
        <Text style={styles.caption}>всего</Text>
      </View>
    </View>
  );
}

/** Цвет доли по её месту в списке — чтобы список и кольцо говорили одно и то же. */
export function sliceColor(index: number): string {
  return index < SLICE_COLORS.length ? SLICE_COLORS[index] : REST_COLOR;
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignSelf: "center", alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center" },
  total: { color: colors.text, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  caption: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
