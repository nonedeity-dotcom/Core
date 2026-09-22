import { View, Text, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { formatDateShort } from "../../lib/date";
import { HISTORY_LIMIT, formatAmount, type Purse } from "../../lib/rewards/currency";

/**
 * Кошелёк: сколько есть и что было.
 *
 * Журнал показывает обе стороны. Раньше он назывался «Начисления» и честно показывал
 * только приход: купил тему за десять ядер, потратил восемьдесят искр на подсказку — в
 * списке пусто, числа просто стали меньше, и через месяц на вопрос «куда делись ядра»
 * ответить было нечем.
 */
export default function WalletScreen({ purse }: { purse: Purse }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.walletRow}>
        <Coin icon="zap" value={purse.wallet.sparks} forms={["искра", "искры", "искр"]} tint={colors.accent} />
        <Coin icon="hexagon" value={purse.wallet.cores} forms={["ядро", "ядра", "ядер"]} tint={colors.accentGreen} />
      </View>
      <Text style={styles.note}>
        Искры капают за закрытые дни, фокус-сессии, записанную еду, вес и собранные поля —
        их тратят на подсказки. Ядра даются редко: за вехи серии, написанный итог месяца и
        закрытую цель, — и уходят на то, что остаётся навсегда.
      </Text>

      <Text style={[styles.sectionLabel, styles.spaced]}>Движение</Text>
      {purse.history.length === 0 ? (
        <Text style={styles.note}>Пока ничего не приходило и не уходило.</Text>
      ) : (
        purse.history.map((h, i) => (
          <View key={`${h.key}:${i}`} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{h.title}</Text>
              <Text style={styles.rowHint}>{formatDateShort(h.at)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Amount value={h.sparks} forms={["искра", "искры", "искр"]} />
              <Amount value={h.cores} forms={["ядро", "ядра", "ядер"]} />
            </View>
          </View>
        ))
      )}

      <Text style={styles.footnote}>
        {`Показаны последние ${HISTORY_LIMIT}. Каждое событие оплачивается один раз: если поменять правило дня, задним числом ничего не доплатится и не отнимется.`}
      </Text>
    </ScrollView>
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
      <Text style={[styles.coinValue, { color: tint }]}>{formatAmount(value)}</Text>
      <Text style={styles.coinLabel}>{plural(value, forms)}</Text>
    </View>
  );
}

/**
 * Сумма со знаком. Ноль не печатается вовсе.
 *
 * Строка бывает и в одну валюту, и в обе сразу — переплавка тратит искры и даёт ядро, — но
 * «+0 ядер» рядом с настоящим числом читается как ошибка, а не как ноль.
 */
function Amount({ value, forms }: { value: number; forms: [string, string, string] }) {
  if (value === 0) return null;
  const up = value > 0;
  return (
    <Text style={[styles.amount, up ? styles.amountUp : styles.amountDown]}>
      {`${up ? "+" : "−"}${Math.abs(value)} ${plural(Math.abs(value), forms)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  walletRow: { flexDirection: "row", gap: 10 },
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
  coinValue: { fontSize: 20, fontWeight: "700" },
  coinLabel: { color: colors.textMuted, fontSize: 11, flex: 1 },

  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 22 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 22 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  amount: { fontSize: 11, fontVariant: ["tabular-nums"] },
  amountUp: { color: colors.accentGreen },
  // Не красный: трата — это не беда, а то, ради чего монеты и нужны.
  amountDown: { color: colors.textMuted },
});
