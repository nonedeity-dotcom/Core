import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { equip, type Purse } from "../../lib/rewards/currency";
import {
  BUYABLE_TITLES,
  TITLE_RULES,
  nextTitle,
  titleProgress,
  type EarnedTitle,
  type TitleState,
} from "../../lib/rewards/catalog";

/**
 * Титулы: те, что за дело, и те, что за ядра.
 *
 * Заработанный купить нельзя, и в этом весь его смысл: за ним стоит то, что действительно
 * случилось. Купленный не стоит ничего, и это сказано прямо — украшение, которое честнее
 * назвать украшением, чем выдать за достижение.
 *
 * Запертый титул говорит, сколько осталось. Замок, который молчит, превращает список в
 * перечень того, чего у тебя нет.
 */
export default function TitlesScreen({
  purse,
  titles,
  titleState,
  closedDays,
}: {
  purse: Purse;
  titles: EarnedTitle[];
  titleState: TitleState;
  closedDays: number;
}) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: Purse) => api.setPurse(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purse"] }),
  });
  const wear = (id: string) => save.mutate(equip(purse, "title", id));

  const near = nextTitle(titleState);
  const bought = BUYABLE_TITLES.filter((t) => purse.owned.includes(t.id));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>
        {`${titles.length} из ${TITLE_RULES.length} · закрыто дней за всё время: ${closedDays}`}
      </Text>
      <Text style={styles.note}>
        {near === null
          ? "Все титулы за дело взяты. Дальше — только те, что за ядра."
          : `Ближе всего «${near.rule.title}»: ${near.have} из ${near.need}, осталось ${near.need - near.have}.`}
      </Text>

      <Text style={[styles.sectionLabel, styles.spaced]}>За дело</Text>
      {TITLE_RULES.map((rule) => {
        const has = titles.some((t) => t.id === rule.id);
        const progress = titleProgress(rule, titleState);
        return (
          <View key={rule.id} style={[styles.row, has && styles.rowOn]}>
            <Feather name={has ? "award" : "lock"} size={18} color={has ? colors.accentGreen : colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, !has && styles.rowTitleOff]}>{rule.title}</Text>
              <Text style={styles.rowHint}>{rule.hint}</Text>
              {!has && <Progress have={progress.have} need={progress.need} />}
            </View>
            {has && <Wear on={purse.equipped.title === rule.id} onPress={() => wear(rule.id)} />}
          </View>
        );
      })}

      {bought.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, styles.spaced]}>Купленные</Text>
          {bought.map((t) => (
            <View key={t.id} style={[styles.row, purse.equipped.title === t.id && styles.rowOn]}>
              <Feather name="award" size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t.title}</Text>
                <Text style={styles.rowHint}>{t.hint}</Text>
              </View>
              <Wear on={purse.equipped.title === t.id} onPress={() => wear(t.id)} />
            </View>
          ))}
        </>
      )}

      {purse.equipped.title !== "" && (
        <Pressable
          onPress={() => wear("")}
          accessibilityRole="button"
          accessibilityLabel="Снять титул"
          style={({ pressed }) => [styles.plain, pressed && styles.dimmed]}
        >
          <Text style={styles.plainText}>Снять титул</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

/** «Надето» или «Надеть» — одна кнопка на обе половины списка, чтобы выглядели одинаково. */
function Wear({ on, onPress }: { on: boolean; onPress: () => void }) {
  if (on)
    return (
      <View style={styles.wornTag}>
        <Feather name="check" size={12} color={colors.accentGreen} />
        <Text style={styles.wornText}>надето</Text>
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Надеть титул"
      style={({ pressed }) => [styles.wear, pressed && styles.dimmed]}
    >
      <Text style={styles.wearText}>надеть</Text>
    </Pressable>
  );
}

/** Полоска «сколько из скольки» под запертым титулом. */
function Progress({ have, need }: { have: number; need: number }) {
  return (
    <View style={styles.progressRow}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round((have / need) * 100)}%` }]} />
      </View>
      <Text style={styles.progressText}>{`${have} из ${need}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 22 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 10 },

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
  rowOn: { borderWidth: 1, borderColor: "rgba(143,184,154,0.35)" },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowTitleOff: { color: colors.textMuted },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },

  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.bg, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accentGreen },
  progressText: { color: colors.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },

  wear: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(143,184,154,0.16)" },
  wearText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  wornTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  wornText: { color: colors.accentGreen, fontSize: 11 },
  plain: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 2 },
  plainText: { color: colors.textMuted, fontSize: 12, textDecorationLine: "underline" },
  dimmed: { opacity: 0.6 },
});
