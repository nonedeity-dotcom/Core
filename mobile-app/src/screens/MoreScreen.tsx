import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import { titleName } from "../lib/rewards/catalog";
import type { Purse } from "../lib/rewards/currency";
import type { GameStats } from "../lib/games/stats";
import type { Section } from "../navigation/sections";

/**
 * «Ещё» — то, что открывают редко.
 *
 * Пятая кнопка внизу, и в ней лежит всё, что не про сегодняшний день: игра на перерыв,
 * магазин, профиль и настройки. Раньше это были три одинаковые серые строки на
 * Главной, и с каждой новой вещью Главная всё больше становилась списком ссылок вместо
 * ответа на вопрос «как идёт день».
 *
 * Настройки здесь же, а не отдельным пунктом среди разделов: они не раздел, а то, что
 * настраивает все разделы сразу.
 */
export default function MoreScreen({
  onOpen,
  navigation,
}: {
  onOpen: (section: Section) => void;
  navigation: { navigate: (screen: string) => void };
}) {
  const { data: purse } = useQuery<Purse>({ queryKey: ["purse"], queryFn: () => api.getPurse() });
  const { data: games } = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });

  const solved = games?.wordsearch.solved ?? 0;
  const worn = titleName(purse?.equipped.title ?? "");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Row
        icon="grid"
        title="Игры"
        hint={
          solved > 0
            ? `Собрано ${solved} ${plural(solved, ["поле", "поля", "полей"])}`
            : "Размяться головой на перерыве"
        }
        onPress={() => onOpen("games")}
      />
      <Row
        icon="shopping-bag"
        title="Магазин"
        hint={
          purse
            ? `${purse.wallet.sparks} ${plural(purse.wallet.sparks, [
                "искра",
                "искры",
                "искр",
              ])} · ${purse.wallet.cores} ${plural(purse.wallet.cores, ["ядро", "ядра", "ядер"])}`
            : "Темы, значки, цвета и титулы за монеты"
        }
        onPress={() => onOpen("shop")}
      />
      <Row
        icon="user"
        title="Профиль"
        hint={worn !== "" ? `${worn} · путь, титулы и коллекция` : "Путь, титулы и коллекция"}
        onPress={() => onOpen("profile")}
      />

      <View style={styles.divider} />

      <Row
        icon="settings"
        title="Настройки"
        hint="Уведомления, данные и правила — для всех разделов"
        onPress={() => navigation.navigate("Settings")}
      />

      <Text style={styles.footnote}>
        Здесь то, что открывают редко. Всё, что про сегодняшний день, — в четырёх кнопках
        слева.
      </Text>
    </ScrollView>
  );
}

function Row({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Feather name={icon} size={18} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 8,
  },
  pressed: { opacity: 0.75 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginVertical: 12 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
});
