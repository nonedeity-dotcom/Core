import { View, Text, ScrollView, StyleSheet } from "react-native";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { formatDateShort } from "../../lib/date";
import { HISTORY_LIMIT, type Purse } from "../../lib/rewards/currency";
import WalletRow from "../../components/WalletRow";

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
      <WalletRow wallet={purse.wallet} />
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
        {`Показаны последние ${HISTORY_LIMIT}. Каждое событие оплачивается один раз. Прошедший день рассчитывается через два дня после того, как закончился, и дальше смена правил его не трогает: задним числом ничего не доплатится и не отнимется.`}
      </Text>
    </ScrollView>
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
