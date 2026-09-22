import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import ItemPreview from "../../components/ItemPreview";
import { equip, type Purse, type Slot } from "../../lib/rewards/currency";
import {
  ACCENTS,
  FIELD_PALETTES,
  ICON_ITEMS,
  THEME_PACKS,
  isOwned,
  shopStanding,
  type ShopItem,
} from "../../lib/rewards/catalog";
import { ICON_PACKS, packOpen } from "../../lib/rewards/icons";

/**
 * Коллекция — что у тебя есть и что из этого надето.
 *
 * В магазине покупают, здесь пользуются. Раньше это была одна строка: купленное стояло в
 * каталоге с кнопкой «надеть», и, чтобы сменить цвет поля, надо было идти в лавку и искать
 * среди того, что ещё не куплено. Теперь своё лежит отдельно от чужого.
 *
 * Не всё надевается: тема слов и набор значков просто открыты — тема появляется в выборе
 * перед партией, значки в редакторе привычки. Поэтому у них не кнопка, а место, где их
 * искать.
 */
export default function CollectionScreen({ purse }: { purse: Purse }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: Purse) => api.setPurse(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purse"] }),
  });
  const wear = (slot: Slot, id: string) => save.mutate(equip(purse, slot, id));

  const mine = (items: ShopItem[]) => items.filter((i) => isOwned(purse.owned, i));
  const palettes = mine(FIELD_PALETTES);
  const accents = mine(ACCENTS);
  const themes = mine(THEME_PACKS);
  const icons = ICON_PACKS.filter((p) => packOpen(p, purse.owned));
  const standing = shopStanding(purse.owned, purse.wallet.cores);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>
        {`Куплено ${standing.have} из ${standing.total}${
          standing.affordable > 0 ? ` · по карману ещё ${standing.affordable}` : ""
        }`}
      </Text>

      <Text style={[styles.sectionLabel, styles.spacedSmall]}>Цвета найденных слов</Text>
      {palettes.map((item) => (
        <Owned
          key={item.id}
          item={item}
          worn={purse.equipped.palette === item.id}
          onWear={() => wear("palette", item.id)}
        />
      ))}

      <Text style={[styles.sectionLabel, styles.spaced]}>Акцентный цвет</Text>
      {accents.map((item) => (
        <Owned
          key={item.id}
          item={item}
          worn={purse.equipped.accent === item.id}
          onWear={() => wear("accent", item.id)}
        />
      ))}
      <Text style={styles.note}>Новый акцент подействует со следующего запуска приложения.</Text>

      <Text style={[styles.sectionLabel, styles.spaced]}>Значки для привычек</Text>
      {icons.map((pack) => (
        <View key={pack.id} style={styles.row}>
          <View style={styles.iconRow}>
            {pack.icons.slice(0, 4).map((name) => (
              <Feather key={name} name={name} size={13} color={colors.textMuted} />
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{pack.title}</Text>
            <Text style={styles.rowHint}>{`${pack.icons.length} значков · выбираются в редакторе привычки`}</Text>
          </View>
        </View>
      ))}
      {ICON_ITEMS.length > icons.filter((p) => p.cores > 0).length && (
        <Text style={styles.note}>
          {`Ещё ${ICON_ITEMS.length - icons.filter((p) => p.cores > 0).length} ${plural(
            ICON_ITEMS.length - icons.filter((p) => p.cores > 0).length,
            ["набор", "набора", "наборов"],
          )} — в магазине.`}
        </Text>
      )}

      <Text style={[styles.sectionLabel, styles.spaced]}>Темы для «Найди слова»</Text>
      {themes.length === 0 ? (
        <Text style={styles.note}>Куплённых тем пока нет — шесть бесплатных и так открыты.</Text>
      ) : (
        themes.map((item) => (
          <View key={item.id} style={styles.row}>
            <Feather name="book-open" size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowHint}>Открыта · выбирается перед партией</Text>
            </View>
          </View>
        ))
      )}

      <Text style={styles.footnote}>
        Купить новое — в «Магазине». Здесь только то, что уже твоё.
      </Text>
    </ScrollView>
  );
}

function Owned({ item, worn, onWear }: { item: ShopItem; worn: boolean; onWear: () => void }) {
  return (
    <View style={[styles.row, worn && styles.rowOn]}>
      <ItemPreview item={item} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowHint}>{item.hint}</Text>
      </View>
      {worn ? (
        <View style={styles.wornTag}>
          <Feather name="check" size={12} color={colors.accentGreen} />
          <Text style={styles.wornText}>надето</Text>
        </View>
      ) : (
        <Pressable
          onPress={onWear}
          accessibilityRole="button"
          accessibilityLabel={`Надеть: ${item.title}`}
          style={({ pressed }) => [styles.wear, pressed && styles.dimmed]}
        >
          <Text style={styles.wearText}>надеть</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 22 },
  spacedSmall: { marginTop: 12 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 24 },

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
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  iconRow: { flexDirection: "row", flexWrap: "wrap", width: 34, gap: 4 },

  wear: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(143,184,154,0.16)" },
  wearText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  wornTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  wornText: { color: colors.accentGreen, fontSize: 11 },
  dimmed: { opacity: 0.6 },
});
