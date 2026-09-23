import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { ItemIcon } from "./ItemIcon";
import type { ActionIcon, Dir } from "../../lib/village/game";

/**
 * Кнопки «Опушки»: крестовина слева, действие справа.
 *
 * Крестовина — один круг с четырьмя секторами, а не четыре отдельные кнопки: большим
 * пальцем легче попасть в сторону круга, чем в квадратик. Кнопка действия круглая и
 * крупная, со значком того, что перед тобой, — топор у дерева, ягоды у куста, луна у
 * костра ночью. Подпись под ней, а не в ней: значок читается быстрее слова.
 */

const ARROW: Record<Dir, "chevron-up" | "chevron-down" | "chevron-left" | "chevron-right"> = {
  up: "chevron-up",
  down: "chevron-down",
  left: "chevron-left",
  right: "chevron-right",
};
const DIR_NAME: Record<Dir, string> = { up: "Вверх", down: "Вниз", left: "Влево", right: "Вправо" };

export function DPad({
  size,
  onStart,
  onStop,
  onTap,
  floating = false,
}: {
  size: number;
  onStart: (d: Dir) => void;
  onStop: () => void;
  onTap: (d: Dir) => void;
  /** Поверх карты — полупрозрачная, чтобы не закрывать лес. */
  floating?: boolean;
}) {
  const b = size * 0.36;
  const pos: Record<Dir, { left: number; top: number }> = {
    up: { left: (size - b) / 2, top: 2 },
    down: { left: (size - b) / 2, top: size - b - 2 },
    left: { left: 2, top: (size - b) / 2 },
    right: { left: size - b - 2, top: (size - b) / 2 },
  };
  return (
    <View
      style={[
        styles.pad,
        { width: size, height: size, borderRadius: size / 2 },
        floating && styles.padFloating,
      ]}
    >
      <View style={[styles.padCenter, { width: b * 0.7, height: b * 0.7, borderRadius: b, left: (size - b * 0.7) / 2, top: (size - b * 0.7) / 2 }]} />
      {(Object.keys(pos) as Dir[]).map((d) => (
        <Pressable
          key={d}
          onPressIn={() => onStart(d)}
          onPressOut={onStop}
          onPress={() => onTap(d)}
          accessibilityRole="button"
          accessibilityLabel={DIR_NAME[d]}
          hitSlop={6}
          style={({ pressed }) => [
            styles.padButton,
            { width: b, height: b, borderRadius: b / 2, ...pos[d] },
            pressed && styles.padPressed,
          ]}
        >
          <Feather name={ARROW[d]} size={b * 0.62} color={colors.text} />
        </Pressable>
      ))}
    </View>
  );
}

export function ActionButton({
  size,
  label,
  icon,
  onPress,
  floating = false,
}: {
  size: number;
  label: string | null;
  icon: ActionIcon;
  onPress: () => void;
  floating?: boolean;
}) {
  const off = !label;
  return (
    <View style={styles.actionWrap}>
      <Pressable
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={label ?? "Действие"}
        style={({ pressed }) => [
          styles.action,
          { width: size, height: size, borderRadius: size / 2 },
          off && styles.actionOff,
          off && floating && styles.actionOffFloating,
          pressed && styles.actionPressed,
        ]}
      >
        {icon ? <ItemIcon id={icon} size={size * 0.5} /> : <Feather name="target" size={size * 0.34} color={colors.textMuted} />}
      </Pressable>
      <Text style={[styles.actionLabel, off && styles.muted, floating && styles.shadowText]} numberOfLines={1}>
        {label ?? "Подойди ближе"}
      </Text>
    </View>
  );
}

/** Круглая кнопка поменьше: сумка, разобрать, поесть, поворот. */
export function RoundButton({
  icon,
  label,
  onPress,
  children,
  badge,
  floating = false,
  size = 46,
}: {
  icon?: ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  children?: ReactNode;
  badge?: string;
  floating?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2 },
        floating && styles.roundFloating,
        pressed && styles.roundPressed,
      ]}
    >
      {children ?? (icon && <Feather name={icon} size={size * 0.4} color={colors.text} />)}
      {badge !== undefined && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.textMuted },
  shadowText: { textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },

  pad: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  padFloating: { backgroundColor: "rgba(18,21,26,0.55)", borderColor: "rgba(255,255,255,0.08)" },
  padCenter: { position: "absolute", backgroundColor: "rgba(255,255,255,0.05)" },
  padButton: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  padPressed: { backgroundColor: "rgba(143,184,154,0.45)" },

  actionWrap: { alignItems: "center", gap: 6 },
  action: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentGreen,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  actionOff: { backgroundColor: colors.card, borderColor: colors.cardBorder, elevation: 0, shadowOpacity: 0 },
  actionOffFloating: { backgroundColor: "rgba(18,21,26,0.55)" },
  actionPressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  actionLabel: { color: colors.text, fontSize: 13, fontWeight: "700", maxWidth: 140, textAlign: "center" },

  round: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  roundFloating: { backgroundColor: "rgba(18,21,26,0.6)", borderColor: "rgba(255,255,255,0.08)" },
  roundPressed: { transform: [{ scale: 0.92 }] },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.bg, fontSize: 10, fontWeight: "800" },
});
