import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { todayKey } from "../../lib/date";
import ItemPreview from "../../components/ItemPreview";
import WalletRow from "../../components/WalletRow";
import { useSavePurse } from "../../lib/rewards/useSavePurse";
import { MELT, buy, canAfford, equip, melt, meltWaitDays, type Purse, type Slot } from "../../lib/rewards/currency";
import {
  ACCENTS,
  BUYABLE_TITLES,
  FIELD_PALETTES,
  ICON_ITEMS,
  THEME_PACKS,
  isOwned,
  priceOf,
  purchaseTitle,
  shopStanding,
  type ItemKind,
  type ShopItem,
} from "../../lib/rewards/catalog";

/**
 * Магазин — только покупка.
 *
 * Раньше это была одна из трёх вкладок раздела «Награды», и там же надевали купленное,
 * смотрели титулы и читали журнал. Получалась лавка, склад и биография в одном ящике.
 * Теперь надетое и нажитое живут в «Профиле», а здесь остаётся единственный вопрос: что
 * купить и хватает ли.
 *
 * Купленное из списка не пропадает и показывается пометкой «куплено»: каталог, из которого
 * исчезает всё, что ты взял, перестаёт отвечать на вопрос «а что тут вообще есть».
 */

/**
 * Куда встаёт купленное, если его вообще надевают.
 *
 * У темы и набора значков слота нет, и это не пропуск: их не надевают, а открывают —
 * открытая тема появляется в выборе перед партией, значки в редакторе привычки.
 */
const SLOTS: Record<ItemKind, Slot | null> = {
  fieldPalette: "palette",
  accent: "accent",
  title: "title",
  theme: null,
  icons: null,
};

export default function ShopScreen({ purse }: { purse: Purse }) {
  const save = useSavePurse();
  const today = todayKey();

  /**
   * Покупка сразу надевает купленное.
   *
   * Кроме титула, если один уже надет: титул один, и менять надетый на только что
   * купленный за человека — значит решать за него. Набор цветов и акцент так не спорят:
   * купил — увидел, а не пошёл искать, где это включается.
   */
  const take = (item: ShopItem) =>
    save.mutate((current) => {
      const bought = buy(current, item.id, priceOf(item), purchaseTitle(item), today);
      if (!bought) return null;
      const slot = SLOTS[item.kind];
      const keep = slot === null || (slot === "title" && bought.equipped.title !== "");
      return keep ? bought : equip(bought, slot as Slot, item.id);
    });

  const wait = meltWaitDays(purse, today);
  const poor = purse.wallet.sparks < MELT.sparks;
  const melting = () => save.mutate((current) => melt(current, today));

  const standing = shopStanding(purse.owned, purse.wallet.cores);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <WalletRow wallet={purse.wallet} />
      <Text style={[styles.sectionLabel, styles.spacedSmall]}>
        {`Куплено ${standing.have} из ${standing.total}${
          standing.affordable > 0
            ? ` · по карману ещё ${standing.affordable}`
            : standing.have === standing.total
              ? " · всё"
              : " · пока ни на что не хватает"
        }`}
      </Text>

      <Text style={[styles.sectionLabel, styles.spacedSmall]}>Переплавка</Text>
      <View style={styles.row}>
        <Feather name="repeat" size={18} color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{`${MELT.sparks} искр → ${MELT.cores} ядро`}</Text>
          <Text style={styles.rowHint}>
            {wait > 0
              ? `Ещё ${wait} ${plural(wait, ["день", "дня", "дней"])}`
              : poor
                ? `Не хватает ${MELT.sparks - purse.wallet.sparks}`
                : "Раз в неделю, не чаще"}
          </Text>
        </View>
        <Pressable
          onPress={melting}
          disabled={wait > 0 || poor}
          accessibilityRole="button"
          accessibilityLabel="Переплавить искры в ядро"
          style={({ pressed }) => [styles.buy, (wait > 0 || poor) && styles.buyOff, pressed && styles.dimmed]}
        >
          <Text style={[styles.buyText, (wait > 0 || poor) && styles.buyTextOff]}>переплавить</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>
        Курс скверный намеренно, и чаще раза в неделю нельзя. Иначе гора искр, которая
        копится сама собой, превращалась бы в горсть ядер за один тап, и всё, что должно
        стоить недель, покупалось бы за вечер.
      </Text>

      <Group
        title="Темы для «Найди слова»"
        note="Единственное здесь, что не красит, а прибавляет: пятьдесят новых слов — это не другой оттенок полоски, а другая игра на вечер."
        items={THEME_PACKS}
        purse={purse}
        onBuy={take}
      />
      <Group
        title="Значки для привычек"
        note="Единственное купленное, что видно каждый день: значок стоит у названия привычки в чек-листе. Выбирается там же, в редакторе привычки."
        items={ICON_ITEMS}
        purse={purse}
        onBuy={take}
      />
      <Group title="Цвета найденных слов" items={FIELD_PALETTES} purse={purse} onBuy={take} />
      <Group
        title="Акцентный цвет приложения"
        note="Подействует со следующего запуска: цвета запоминаются экранами при загрузке, и поменять их на лету нельзя. Обещать мгновенную смену и не сделать — хуже."
        items={ACCENTS}
        purse={purse}
        onBuy={take}
      />
      <Group
        title="Титулы за ядра"
        note="За этими ничего не стоит — это украшение, и так честнее. Те, что за дело, в «Профиле», и купить их нельзя."
        items={BUYABLE_TITLES}
        purse={purse}
        onBuy={take}
      />

      <Text style={styles.footnote}>
        Надеть купленное — в «Профиле», во вкладке «Коллекция». Здесь только покупают.
      </Text>
    </ScrollView>
  );
}

function Group({
  title,
  note,
  items,
  purse,
  onBuy,
}: {
  title: string;
  note?: string;
  items: ShopItem[];
  purse: Purse;
  onBuy: (item: ShopItem) => void;
}) {
  return (
    <>
      <Text style={[styles.sectionLabel, styles.spaced]}>{title}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}
      {items.map((item) => (
        <ShopRow key={item.id} item={item} purse={purse} onBuy={() => onBuy(item)} />
      ))}
    </>
  );
}

function ShopRow({ item, purse, onBuy }: { item: ShopItem; purse: Purse; onBuy: () => void }) {
  const owned = isOwned(purse.owned, item);
  const affordable = canAfford(purse.wallet, priceOf(item));
  return (
    <View style={[styles.row, owned && styles.rowOwned]}>
      <ItemPreview item={item} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowHint}>{item.hint}</Text>
      </View>
      {owned ? (
        <Text style={styles.ownedText}>{item.cores === 0 ? "бесплатно" : "куплено"}</Text>
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
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 22 },
  spacedSmall: { marginTop: 12 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 10 },
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
  // Купленное приглушено, но не спрятано: каталог должен оставаться каталогом.
  rowOwned: { opacity: 0.65 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },

  buy: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(143,184,154,0.16)" },
  buyOff: { backgroundColor: colors.bg },
  buyText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  buyTextOff: { color: colors.textMuted },
  ownedText: { color: colors.textMuted, fontSize: 11 },
  dimmed: { opacity: 0.6 },
});
