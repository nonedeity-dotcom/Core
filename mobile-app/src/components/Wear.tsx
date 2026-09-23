import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";

/**
 * «Надето» или «надеть» — одна кнопка на всё, что надевается.
 *
 * Была в двух копиях — в коллекции и в титулах, — и копии уже разошлись подписями для
 * экранного чтения. Теперь одна, и титул с набором цветов выглядят одинаково.
 */
export default function Wear({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  if (on)
    return (
      <View style={styles.tag}>
        <Feather name="check" size={12} color={colors.accentGreen} />
        <Text style={styles.tagText}>надето</Text>
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Надеть: ${label}`}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>надеть</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: "row", alignItems: "center", gap: 4 },
  tagText: { color: colors.accentGreen, fontSize: 11 },
  button: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(143,184,154,0.16)" },
  buttonText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.6 },
});
