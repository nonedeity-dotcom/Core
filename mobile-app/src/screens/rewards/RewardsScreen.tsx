import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { iconPackById } from "../../lib/rewards/icons";
import { plural } from "../../lib/plural";
import { formatDateShort, todayKey } from "../../lib/date";
import { useRewards } from "../../lib/rewards/useRewards";
import {
  HISTORY_LIMIT,
  MELT,
  buy,
  canAfford,
  equip,
  formatAmount,
  melt,
  meltWaitDays,
  type Purse,
  type Slot,
} from "../../lib/rewards/currency";
import {
  ACCENTS,
  BUYABLE_TITLES,
  FIELD_PALETTES,
  ICON_ITEMS,
  THEME_PACKS,
  TITLE_RULES,
  isOwned,
  nextTitle,
  priceOf,
  purchaseTitle,
  shopStanding,
  titleProgress,
  type ItemKind,
  type ShopItem,
} from "../../lib/rewards/catalog";

/**
 * В каком слоте живёт товар.
 *
 * У темы слов слота нет, и это не пропуск: её не надевают, а открывают — открытая тема
 * просто появляется в выборе перед партией, все сразу и вместе.
 */
const SLOTS: Record<ItemKind, Slot | null> = {
  fieldPalette: "palette",
  accent: "accent",
  title: "title",
  theme: null,
  // Значки, как и темы, не надевают: набор открывается целиком, а выбирают уже у самой
  // привычки — там, где видно, к чему значок прикладывается.
  icons: null,
};

type Tab = "shop" | "titles" | "wallet";

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
  const { purse, titles, closedDays, titleState } = useRewards();
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
    const bought = buy(purse, item.id, priceOf(item), purchaseTitle(item), todayKey());
    if (!bought) return;
    const slot = SLOTS[item.kind];
    const keep = slot === null || (slot === "title" && bought.equipped.title !== "");
    purchase.mutate(keep ? bought : equip(bought, slot as Slot, item.id));
  };

  const wear = (slot: Slot, id: string) => purchase.mutate(equip(purse, slot, id));

  const today = todayKey();
  const wait = meltWaitDays(purse, today);
  const melting = () => {
    const next = melt(purse, today);
    if (next) purchase.mutate(next);
  };

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
          ["wallet", "Кошелёк"],
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
          {(() => {
            const standing = shopStanding(purse.owned, purse.wallet.cores);
            return (
              <Text style={styles.sectionLabel}>
                {`Куплено ${standing.have} из ${standing.total}${
                  standing.affordable > 0
                    ? ` · по карману ещё ${standing.affordable}`
                    : standing.have === standing.total
                      ? " · всё"
                      : " · пока ни на что не хватает"
                }`}
              </Text>
            );
          })()}

          <Text style={[styles.sectionLabel, styles.spacedSmall]}>Переплавка</Text>
          <View style={styles.row}>
            <Feather name="repeat" size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{`${MELT.sparks} искр → ${MELT.cores} ядро`}</Text>
              <Text style={styles.rowHint}>
                {wait > 0
                  ? `Ещё ${wait} ${plural(wait, ["день", "дня", "дней"])}`
                  : purse.wallet.sparks < MELT.sparks
                    ? `Не хватает ${MELT.sparks - purse.wallet.sparks}`
                    : "Раз в неделю, не чаще"}
              </Text>
            </View>
            <Pressable
              onPress={melting}
              disabled={wait > 0 || purse.wallet.sparks < MELT.sparks}
              accessibilityRole="button"
              accessibilityLabel="Переплавить искры в ядро"
              style={({ pressed }) => [
                styles.buy,
                (wait > 0 || purse.wallet.sparks < MELT.sparks) && styles.buyOff,
                pressed && styles.dimmed,
              ]}
            >
              <Text
                style={[
                  styles.buyText,
                  (wait > 0 || purse.wallet.sparks < MELT.sparks) && styles.buyTextOff,
                ]}
              >
                переплавить
              </Text>
            </Pressable>
          </View>
          <Text style={styles.note}>
            Курс скверный намеренно, и чаще раза в неделю нельзя. Иначе гора искр, которая
            копится сама собой, превращалась бы в горсть ядер за один тап, и всё, что должно
            стоить недель, покупалось бы за вечер.
          </Text>

          <Text style={[styles.sectionLabel, styles.spaced]}>Темы для «Найди слова»</Text>
          <Text style={styles.note}>
            Единственное здесь, что не красит, а прибавляет: пятьдесят новых слов — это не
            другой оттенок полоски, а другая игра на вечер.
          </Text>
          {THEME_PACKS.map((item) => (
            <ShopRow key={item.id} item={item} purse={purse} onBuy={() => take(item)} onWear={() => {}} />
          ))}

          <Text style={[styles.sectionLabel, styles.spaced]}>Значки для привычек</Text>
          <Text style={styles.note}>
            Единственное купленное, что видно каждый день: значок стоит у названия привычки в
            чек-листе. Выбирается там же, в редакторе привычки.
          </Text>
          {ICON_ITEMS.map((item) => (
            <ShopRow key={item.id} item={item} purse={purse} onBuy={() => take(item)} onWear={() => {}} />
          ))}

          <Text style={[styles.sectionLabel, styles.spaced]}>Цвета найденных слов</Text>
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
          {(() => {
            const near = nextTitle(titleState);
            return near === null ? (
              <Text style={styles.note}>Все титулы за дело взяты. Дальше — только те, что за ядра.</Text>
            ) : (
              <Text style={styles.note}>
                {`Ближе всего «${near.rule.title}»: ${near.have} из ${near.need}, осталось ${near.need - near.have}.`}
              </Text>
            );
          })()}
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
                  {/* Запертому титулу есть что сказать: замок молчит, а число — нет. */}
                  {!has && (
                    <Progress have={titleProgress(rule, titleState).have} need={titleProgress(rule, titleState).need} />
                  )}
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

      {tab === "wallet" && (
        <>
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
          <Text style={[styles.note, styles.spaced]}>
            {`Показаны последние ${HISTORY_LIMIT}. Каждое событие оплачивается один раз: если
            поменять правило дня, задним числом ничего не доплатится и не отнимется.`}
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

/**
 * Набор цветов на кусочке настоящего поля.
 *
 * Четыре полоски рядом показывали цвета и не показывали главного: как они выглядят
 * полосами поверх клеток и не сливаются ли две соседние. За восемь ядер это кот в мешке —
 * а здесь тот же самый рисунок, что будет в игре, только маленький.
 */
const P_CELL = 7;
const P_GAP = 1;
const P_STEP = P_CELL + P_GAP;
const at = (n: number) => n * P_STEP;
const span = (n: number) => n * P_STEP - P_GAP;

/** Четыре слова на поле шесть на четыре: два поперёк, одно вдоль, одно короткое в углу. */
const P_WORDS = [
  { row: 0, col: 0, len: 3, across: true },
  { row: 0, col: 4, len: 4, across: false },
  { row: 2, col: 1, len: 3, across: true },
  { row: 3, col: 0, len: 2, across: true },
];

function PalettePreview({ colors: palette }: { colors: string[] }) {
  return (
    <View style={{ width: span(6), height: span(4) }}>
      {[0, 1, 2, 3].map((r) => (
        <View key={r} style={{ flexDirection: "row", gap: P_GAP, marginBottom: P_GAP }}>
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <View key={c} style={styles.previewCell} />
          ))}
        </View>
      ))}
      {P_WORDS.map((w, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: at(w.col),
            top: at(w.row),
            width: w.across ? span(w.len) : P_CELL,
            height: w.across ? P_CELL : span(w.len),
            borderRadius: 3,
            backgroundColor: palette[i % palette.length],
            opacity: 0.55,
          }}
        />
      ))}
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
  const slot = SLOTS[item.kind];
  const worn = slot !== null && purse.equipped[slot] === item.id;
  return (
    <View style={[styles.row, worn && styles.rowOn]}>
      {item.colors ? (
        <PalettePreview colors={item.colors} />
      ) : item.color ? (
        <View style={[styles.swatch, styles.swatchBig, { backgroundColor: item.color }]} />
      ) : item.kind === "icons" ? (
        // Сами значки, а не абстрактная медалька: набор покупают ради того, как он выглядит.
        <View style={styles.iconPreview}>
          {(iconPackById(item.id)?.icons ?? []).slice(0, 4).map((name) => (
            <Feather key={name} name={name} size={13} color={colors.textMuted} />
          ))}
        </View>
      ) : (
        <Feather name="award" size={18} color={owned ? colors.accent : colors.textMuted} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowHint}>{item.hint}</Text>
      </View>
      {owned ? (
        slot === null ? (
          <Text style={styles.ownedText}>открыто</Text>
        ) : (
          <Wear on={worn} onPress={onWear} />
        )
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
  spacedSmall: { marginTop: 12 },
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
  amount: { fontSize: 11, fontVariant: ["tabular-nums"] },
  amountUp: { color: colors.accentGreen },
  // Не красный: трата — это не беда, а то, ради чего монеты и нужны.
  amountDown: { color: colors.textMuted },

  previewCell: { width: P_CELL, height: P_CELL, borderRadius: 1, backgroundColor: colors.bg },
  iconPreview: { flexDirection: "row", flexWrap: "wrap", width: 34, gap: 4 },
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
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.bg, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accentGreen },
  progressText: { color: colors.textMuted, fontSize: 10, fontVariant: ["tabular-nums"] },
  wornTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  wornText: { color: colors.accentGreen, fontSize: 11 },
  plain: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 2 },
  plainText: { color: colors.textMuted, fontSize: 12, textDecorationLine: "underline" },
  dimmed: { opacity: 0.6 },
});
