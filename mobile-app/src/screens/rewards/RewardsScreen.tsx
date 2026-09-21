import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { formatDateShort } from "../../lib/date";
import { useRewards } from "../../lib/rewards/useRewards";
import { buy, canAfford, equip, formatAmount, type Purse, type Slot } from "../../lib/rewards/currency";
import {
  ACCENTS,
  BUYABLE_TITLES,
  FIELD_PALETTES,
  TITLE_RULES,
  isOwned,
  priceOf,
  type ItemKind,
  type ShopItem,
} from "../../lib/rewards/catalog";

/** В каком слоте живёт товар. Три вида товаров — три слота, и связь между ними одна. */
const SLOTS: Record<ItemKind, Slot> = { fieldPalette: "palette", accent: "accent", title: "title" };

type Tab = "shop" | "titles" | "history";

/**
 * Награды: кошелёк, магазин и титулы.
 *
 * Две валюты и разница между ними — не украшение. Искры капают за обычные дни и собранные
 * поля, их много, и тратятся они на расходное: подсказку, смену поля. Ядра даются только за
 * то, что случается редко и один раз — веха серии, написанный итог, закрытая цель, — и
 * уходят на то, что остаётся навсегда.
 *
 * Начисление живёт не здесь: его считает useRewards из того же состояния, по которому
 * работает вся остальная статистика. Этот экран только показывает и тратит.
 */
export default function RewardsScreen() {
  const qc = useQueryClient();
  const { purse, titles, closedDays } = useRewards();
  const [tab, setTab] = useState<Tab>("shop");

  const purchase = useMutation({
    mutationFn: (next: Purse) => api.setPurse(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purse"] }),
  });

  if (!purse) return <View style={styles.container} />;

  /**
   * Покупка сразу надевает купленное.
   *
   * Кроме титула, если один уже надет: титул один, и менять надетый на только что
   * купленный за человека — значит решать за него. Набор цветов и акцент так не спорят:
   * купил — увидел, а не пошёл искать, где это включается.
   */
  const take = (item: ShopItem) => {
    const bought = buy(purse, item.id, priceOf(item));
    if (!bought) return;
    const slot = SLOTS[item.kind];
    const keep = slot === "title" && bought.equipped.title !== "";
    purchase.mutate(keep ? bought : equip(bought, slot, item.id));
  };

  const wear = (slot: Slot, id: string) => purchase.mutate(equip(purse, slot, id));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.walletRow}>
        <Coin icon="zap" value={purse.wallet.sparks} forms={["искра", "искры", "искр"]} tint={colors.accent} />
        <Coin icon="hexagon" value={purse.wallet.cores} forms={["ядро", "ядра", "ядер"]} tint={colors.accentGreen} />
      </View>
      <Text style={styles.walletHint}>
        Искры капают за закрытые дни, фокус-сессии и собранные поля — их тратят на подсказки.
        Ядра даются редко: за вехи серии, написанный итог месяца и закрытую цель, — и уходят на
        то, что остаётся навсегда.
      </Text>

      <View style={styles.tabs}>
        {([
          ["shop", "Магазин"],
          ["titles", "Титулы"],
          ["history", "Начисления"],
        ] as [Tab, string][]).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setTab(id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: tab === id }}
            style={({ pressed }) => [styles.tab, tab === id && styles.tabOn, pressed && styles.dimmed]}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "shop" && (
        <>
          <Text style={styles.sectionLabel}>Цвета найденных слов</Text>
          {FIELD_PALETTES.map((item) => (
            <ShopRow
              key={item.id}
              item={item}
              purse={purse}
              onBuy={() => take(item)}
              onWear={() => wear("palette", item.id)}
            />
          ))}

          <Text style={[styles.sectionLabel, styles.spaced]}>Акцентный цвет приложения</Text>
          <Text style={styles.note}>
            Подействует со следующего запуска: цвета запоминаются экранами при загрузке, и
            поменять их на лету нельзя. Обещать мгновенную смену и не сделать — хуже.
          </Text>
          {ACCENTS.map((item) => (
            <ShopRow
              key={item.id}
              item={item}
              purse={purse}
              onBuy={() => take(item)}
              onWear={() => wear("accent", item.id)}
            />
          ))}

          <Text style={[styles.sectionLabel, styles.spaced]}>Титулы за ядра</Text>
          <Text style={styles.note}>
            За этими ничего не стоит — это украшение, и так честнее. Те, что за дело, во
            вкладке рядом, и купить их нельзя.
          </Text>
          {BUYABLE_TITLES.map((item) => (
            <ShopRow
              key={item.id}
              item={item}
              purse={purse}
              onBuy={() => take(item)}
              onWear={() => wear("title", item.id)}
            />
          ))}
        </>
      )}

      {tab === "titles" && (
        <>
          <Text style={styles.sectionLabel}>
            {`${titles.length} из ${TITLE_RULES.length} · закрыто дней за всё время: ${closedDays}`}
          </Text>
          {TITLE_RULES.map((rule) => {
            const has = titles.some((t) => t.id === rule.id);
            return (
              <View key={rule.id} style={[styles.row, has && styles.rowOn]}>
                <Feather
                  name={has ? "award" : "lock"}
                  size={18}
                  color={has ? colors.accentGreen : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, !has && styles.rowTitleOff]}>{rule.title}</Text>
                  <Text style={styles.rowHint}>{rule.hint}</Text>
                </View>
                {has && (
                  <Wear on={purse.equipped.title === rule.id} onPress={() => wear("title", rule.id)} />
                )}
              </View>
            );
          })}
          {purse.equipped.title !== "" && (
            <Pressable
              onPress={() => wear("title", "")}
              accessibilityRole="button"
              accessibilityLabel="Снять титул"
              style={({ pressed }) => [styles.plain, pressed && styles.dimmed]}
            >
              <Text style={styles.plainText}>Снять титул</Text>
            </Pressable>
          )}
          {purse.owned.some((id) => id.startsWith("title-")) && (
            <>
              <Text style={[styles.sectionLabel, styles.spaced]}>Купленные</Text>
              {BUYABLE_TITLES.filter((t) => purse.owned.includes(t.id)).map((t) => (
                <View key={t.id} style={[styles.row, styles.rowOn]}>
                  <Feather name="award" size={18} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t.title}</Text>
                    <Text style={styles.rowHint}>{t.hint}</Text>
                  </View>
                  <Wear on={purse.equipped.title === t.id} onPress={() => wear("title", t.id)} />
                </View>
              ))}
            </>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          {purse.history.length === 0 ? (
            <Text style={styles.note}>Пока ничего не начислялось.</Text>
          ) : (
            purse.history.map((h, i) => (
              <View key={`${h.key}:${i}`} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{h.title}</Text>
                  <Text style={styles.rowHint}>{formatDateShort(h.at)}</Text>
                </View>
                <Text style={styles.gain}>
                  {h.sparks > 0 ? `+${h.sparks} искр` : ""}
                  {h.sparks > 0 && h.cores > 0 ? " · " : ""}
                  {h.cores > 0 ? `+${h.cores} ${plural(h.cores, ["ядро", "ядра", "ядер"])}` : ""}
                </Text>
              </View>
            ))
          )}
          <Text style={[styles.note, styles.spaced]}>
            Показаны последние сорок. Каждое событие оплачивается один раз: если поменять
            правило дня, задним числом ничего не доплатится и не отнимется.
          </Text>
        </>
      )}
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

/** «Надето» или «Надеть» — одна кнопка на все три слота, чтобы выглядели они одинаково. */
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
      accessibilityLabel="Надеть"
      style={({ pressed }) => [styles.buy, pressed && styles.dimmed]}
    >
      <Text style={styles.buyText}>надеть</Text>
    </Pressable>
  );
}

function ShopRow({
  item,
  purse,
  onBuy,
  onWear,
}: {
  item: ShopItem;
  purse: Purse;
  onBuy: () => void;
  onWear: () => void;
}) {
  const owned = isOwned(purse.owned, item);
  const affordable = canAfford(purse.wallet, priceOf(item));
  const worn = purse.equipped[SLOTS[item.kind]] === item.id;
  return (
    <View style={[styles.row, worn && styles.rowOn]}>
      {item.colors ? (
        <View style={styles.swatches}>
          {item.colors.slice(0, 4).map((c) => (
            <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
          ))}
        </View>
      ) : item.color ? (
        <View style={[styles.swatch, styles.swatchBig, { backgroundColor: item.color }]} />
      ) : (
        <Feather name="award" size={18} color={owned ? colors.accent : colors.textMuted} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowHint}>{item.hint}</Text>
      </View>
      {owned ? (
        <Wear on={worn} onPress={onWear} />
      ) : (
        <Pressable
          onPress={onBuy}
          disabled={!affordable}
          accessibilityRole="button"
          accessibilityLabel={`Купить: ${item.title}`}
          style={({ pressed }) => [styles.buy, !affordable && styles.buyOff, pressed && styles.dimmed]}
        >
          <Text style={[styles.buyText, !affordable && styles.buyTextOff]}>
            {item.cores} {plural(item.cores, ["ядро", "ядра", "ядер"])}
          </Text>
        </Pressable>
      )}
    </View>
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
  walletHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10 },

  tabs: { flexDirection: "row", gap: 6, marginTop: 18, marginBottom: 14 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  tabOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  tabText: { color: colors.textMuted, fontSize: 13 },
  tabTextOn: { color: colors.accentGreen, fontWeight: "600" },

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
  gain: { color: colors.accentGreen, fontSize: 11 },

  swatches: { flexDirection: "row", gap: 2 },
  swatch: { width: 8, height: 20, borderRadius: 2 },
  swatchBig: { width: 20, height: 20, borderRadius: 6 },

  buy: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(143,184,154,0.16)",
  },
  buyOff: { backgroundColor: colors.bg },
  buyText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  buyTextOff: { color: colors.textMuted },
  ownedText: { color: colors.textMuted, fontSize: 11 },
  wornTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  wornText: { color: colors.accentGreen, fontSize: 11 },
  plain: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 2 },
  plainText: { color: colors.textMuted, fontSize: 12, textDecorationLine: "underline" },
  dimmed: { opacity: 0.6 },
});
