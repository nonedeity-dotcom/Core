import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import type { GoalItem } from "../lib/goals";

/**
 * Пункты цели с галочками.
 *
 * Галочка здесь ничего не считает: приложение не знает, выучены ли билеты, и не должно
 * делать вид, что знает. Она помнит за человека — и ровно поэтому её ставят вручную, а не
 * выводят из чего-нибудь.
 *
 * Общий на два экрана: цель редактируют на одном, а отмечают чаще всего на другом — в итоге
 * месяца. Два списка с разным поведением галочки читались бы как два разных списка.
 */
export default function GoalChecklist({
  items,
  onToggle,
  onRemove,
  empty,
}: {
  items: GoalItem[];
  onToggle: (id: string) => void;
  /** Без него пункты только отмечаются — так итог не превращается в редактирование задним числом. */
  onRemove?: (id: string) => void;
  empty?: string;
}) {
  if (items.length === 0) {
    return empty ? <Text style={styles.empty}>{empty}</Text> : null;
  }
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Pressable
            onPress={() => onToggle(item.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={item.text}
            hitSlop={8}
            style={({ pressed }) => [styles.box, item.done && styles.boxDone, pressed && { opacity: 0.6 }]}
          >
            {item.done && <Feather name="check" size={13} color={colors.bg} />}
          </Pressable>
          <Text style={[styles.text, item.done && styles.textDone]}>{item.text}</Text>
          {onRemove && (
            <Pressable
              onPress={() => onRemove(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Убрать: ${item.text}`}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Feather name="x" size={15} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  boxDone: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  text: { color: colors.text, fontSize: 14, flex: 1, lineHeight: 19 },
  textDone: { color: colors.textMuted, textDecorationLine: "line-through" },
  empty: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
