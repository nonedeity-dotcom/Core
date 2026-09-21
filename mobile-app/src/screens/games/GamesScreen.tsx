import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import type { GameStats } from "../../lib/games/stats";

/**
 * Раздел «Игры».
 *
 * Отдельный раздел, а не строка на главном экране: игра, до которой один тап от чек-листа, —
 * это готовый способ не делать чек-лист. Сюда надо зайти намеренно, и этого достаточно.
 *
 * Список, а не сразу игра: игр планируется несколько, и экран, который сегодня открывает
 * одну, а завтра должен открывать три, лучше сделать списком сразу.
 */
export default function GamesScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string) => void };
}) {
  const { data: stats } = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });
  const solved = stats?.wordsearch.solved ?? 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Размяться головой, когда голова уже не варит на работу. За собранное поле капают
        искры, но ничего не сгорает и не кончается: ни жизней, ни ежедневного входа. Не
        зашёл неделю — ничего не потерял.
      </Text>

      <Pressable
        onPress={() => navigation.navigate("WordSearch")}
        accessibilityRole="button"
        accessibilityLabel="Найди слова"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Feather name="grid" size={18} color={colors.accentGreen} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Найди слова</Text>
          <Text style={styles.rowHint}>
            {solved > 0
              ? `Поле из букв, слова по теме · собрано ${solved} ${plural(solved, ["поле", "поля", "полей"])}`
              : "Поле из букв, в нём спрятаны слова по теме"}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Text style={styles.soon}>
        Дальше здесь появятся кроссворд с колесом букв и шахматы.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pressed: { opacity: 0.7 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  chevron: { color: colors.textMuted, fontSize: 20 },
  soon: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 16 },
});
