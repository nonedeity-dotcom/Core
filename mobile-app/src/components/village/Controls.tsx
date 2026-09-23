import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { ItemIcon } from "./ItemIcon";
import type { ActionIcon } from "../../lib/village/game";

/**
 * Кнопки «Опушки» (ходьба — отдельно, в MovePad).
 *
 * Кнопка действия круглая и
 * крупная, со значком того, что перед тобой, — топор у дерева, ягоды у куста, луна у
 * костра ночью. Подпись под ней, а не в ней: значок читается быстрее слова.
 */

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
