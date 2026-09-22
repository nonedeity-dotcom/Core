import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import type { Section } from "./sections";

/**
 * Разделы — внизу, всегда на одном месте.
 *
 * Раньше они жили за кнопкой «три линии» в углу, и это была ошибка: раздел — не настройка,
 * а то, чем приложение сейчас является. До любого было два тапа, а полоса под большим
 * пальцем при этом то появлялась, то исчезала — в Стержне пять вкладок, в CaloriX три, в
 * Creker и «Наградах» ничего. Самое ценное место экрана меняло смысл под ногами.
 *
 * Теперь оно занято одним и тем же навсегда: где ты и куда можно уйти. Вкладки внутри
 * раздела переехали наверх — их меньше и меняют их реже.
 */

const ITEMS: { id: Section; title: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
  { id: "home", title: "Главная", icon: "home" },
  { id: "sterzhen", title: "Sterzhen", icon: "check-square" },
  { id: "balance", title: "CaloriX", icon: "pie-chart" },
  { id: "screen", title: "Creker", icon: "smartphone" },
  { id: "more", title: "Ещё", icon: "more-horizontal" },
];

/** «Ещё» держит то, что открывают редко, и подсвечивается, пока ты внутри любого из них. */
const UNDER_MORE: Section[] = ["more", "games", "rewards"];

export default function SectionBar({
  section,
  onSelect,
}: {
  section: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <View style={styles.bar}>
      {ITEMS.map((item) => {
        const active = item.id === "more" ? UNDER_MORE.includes(section) : item.id === section;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.title}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <Feather name={item.icon} size={18} color={active ? colors.accentGreen : colors.textMuted} />
            <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
              {item.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 7,
    paddingBottom: 9,
  },
  // Равные доли, а не отступы: пять подписей на узком экране должны делить ширину поровну,
  // иначе «Главная» отбирает место у «Ещё» и та переносится.
  item: { flex: 1, alignItems: "center", gap: 3 },
  pressed: { opacity: 0.6 },
  label: { color: colors.textMuted, fontSize: 10 },
  labelOn: { color: colors.accentGreen, fontWeight: "600" },
});
