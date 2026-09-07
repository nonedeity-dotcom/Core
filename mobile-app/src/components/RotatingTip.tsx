import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFold } from "../lib/useFold";
import { useRotatingTip } from "../lib/useRotatingTip";
import { colors } from "../theme/colors";
import TipCard from "./TipCard";

/**
 * The tip at the top of the first screen you land on.
 *
 * It steps forward every time you open the app and starts over at the end, so
 * the number beside it is what tells you where you are — without it the
 * rotation would look like it was picking at random.
 */
export default function RotatingTip() {
  const rotating = useRotatingTip();
  // Collapsed again whenever you leave the screen — an opened tip is something you read
  // once, not a card you want permanently unfolded above the number.
  const { open, toggle } = useFold();

  if (!rotating) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Feather name="zap" size={12} color={colors.accent} />
        <Text style={styles.label}>
          Подсказка {rotating.number} из {rotating.total}
        </Text>
      </View>
      <TipCard
        tip={rotating.tip}
        number={rotating.number}
        expanded={open}
        onToggle={toggle}
        highlight
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  // Accent, not muted: the label used to be the same grey as every other caption on the
  // screen, so the one card that is advice rather than a measurement read as more chrome.
  label: { color: colors.accent, fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
});
