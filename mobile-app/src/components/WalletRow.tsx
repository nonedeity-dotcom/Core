import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { formatAmount, type Wallet } from "../lib/rewards/currency";

/**
 * Сколько искр и ядер — строкой из двух монет.
 *
 * Общая, потому что нужна в двух местах: в кошельке и над магазином. Над магазином её не
 * было после того, как «Награды» разделились, и покупать приходилось вслепую — видно цену,
 * не видно, сколько у тебя.
 */
export default function WalletRow({ wallet }: { wallet: Wallet }) {
  return (
    <View style={styles.row}>
      <Coin icon="zap" value={wallet.sparks} forms={["искра", "искры", "искр"]} tint={colors.accent} />
      <Coin icon="hexagon" value={wallet.cores} forms={["ядро", "ядра", "ядер"]} tint={colors.accentGreen} />
    </View>
  );
}

function Coin({
  icon,
  value,
  forms,
  tint,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  value: number;
  forms: [string, string, string];
  tint: string;
}) {
  return (
    <View style={styles.coin}>
      <Feather name={icon} size={16} color={tint} />
      <Text style={[styles.value, { color: tint }]}>{formatAmount(value)}</Text>
      <Text style={styles.label}>{plural(value, forms)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  coin: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  value: { fontSize: 20, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 11, flex: 1 },
});
