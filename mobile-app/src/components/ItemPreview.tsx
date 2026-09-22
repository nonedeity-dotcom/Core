import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { iconPackById } from "../lib/rewards/icons";
import type { ShopItem } from "../lib/rewards/catalog";

/**
 * Как товар выглядит в строке — в магазине и в коллекции одинаково.
 *
 * Общий файл, потому что это ровно тот случай, когда две копии разойдутся: набор цветов
 * показан на кусочке поля, и если в коллекции он останется четырьмя полосками, человек
 * увидит две разные вещи под одним названием.
 */

/** Клетка и зазор макета поля. Мелко нарочно: это подпись к строке, а не иллюстрация. */
const CELL = 7;
const GAP = 1;
const STEP = CELL + GAP;
const at = (n: number) => n * STEP;
const span = (n: number) => n * STEP - GAP;

/** Четыре слова на поле шесть на четыре: два поперёк, одно вдоль, одно короткое в углу. */
const WORDS = [
  { row: 0, col: 0, len: 3, across: true },
  { row: 0, col: 4, len: 4, across: false },
  { row: 2, col: 1, len: 3, across: true },
  { row: 3, col: 0, len: 2, across: true },
];

/**
 * Набор цветов на кусочке настоящего поля.
 *
 * Четыре полоски рядом показывали цвета и не показывали главного: как они выглядят
 * полосами поверх клеток и не сливаются ли две соседние. За восемь ядер это кот в мешке —
 * а здесь тот же самый рисунок, что будет в игре, только маленький.
 */
export function PalettePreview({ colors: palette }: { colors: string[] }) {
  return (
    <View style={{ width: span(6), height: span(4) }}>
      {[0, 1, 2, 3].map((r) => (
        <View key={r} style={{ flexDirection: "row", gap: GAP, marginBottom: GAP }}>
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <View key={c} style={styles.cell} />
          ))}
        </View>
      ))}
      {WORDS.map((w, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: at(w.col),
            top: at(w.row),
            width: w.across ? span(w.len) : CELL,
            height: w.across ? CELL : span(w.len),
            borderRadius: 3,
            backgroundColor: palette[i % palette.length],
            opacity: 0.55,
          }}
        />
      ))}
    </View>
  );
}

/** Значок товара: поле для цветов, кружок для акцента, сами значки для набора значков. */
export default function ItemPreview({ item }: { item: ShopItem }) {
  if (item.colors) return <PalettePreview colors={item.colors} />;
  if (item.color) return <View style={[styles.swatch, { backgroundColor: item.color }]} />;
  if (item.kind === "icons")
    return (
      // Сами значки, а не абстрактная медалька: набор покупают ради того, как он выглядит.
      <View style={styles.icons}>
        {(iconPackById(item.id)?.icons ?? []).slice(0, 4).map((name) => (
          <Feather key={name} name={name} size={13} color={colors.textMuted} />
        ))}
      </View>
    );
  return <Feather name="award" size={18} color={colors.textMuted} />;
}

const styles = StyleSheet.create({
  cell: { width: CELL, height: CELL, borderRadius: 1, backgroundColor: colors.bg },
  swatch: { width: 20, height: 20, borderRadius: 6 },
  icons: { flexDirection: "row", flexWrap: "wrap", width: 34, gap: 4 },
});
