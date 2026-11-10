import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { formatDayLong, todayKey, weekdayLabel } from "../lib/date";
import { plural } from "../lib/plural";
import { previewOf, type DayNote } from "../lib/dayNotes";

/**
 * Все итоги дня списком, свежие сверху, каждый со своей датой.
 *
 * Список, а не лента из полных текстов: итог может быть длинным, и перелистывать сотню
 * таких — не то же, что найти нужный день. Нажатие открывает итог целиком.
 */
export default function DayNotesScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void };
}) {
  const { data: notes = [], isSuccess } = useQuery<DayNote[]>({
    queryKey: ["dayNotes"],
    queryFn: () => api.getDayNotes(),
  });
  const thisYear = todayKey().slice(0, 4);

  // Год пишется только у дней не этого года: «10 ноября» этого года и так понятно, а
  // «10 ноября» двухлетней давности без года — загадка.
  const label = (date: string) =>
    date.slice(0, 4) === thisYear ? formatDayLong(date) : `${formatDayLong(date)} ${date.slice(0, 4)}`;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      data={notes}
      keyExtractor={(n) => n.date}
      initialNumToRender={12}
      windowSize={7}
      ListHeaderComponent={
        isSuccess && notes.length > 0 ? (
          <Text style={styles.count}>
            {notes.length} {plural(notes.length, ["итог", "итога", "итогов"])}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        isSuccess ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Итогов пока нет</Text>
            <Text style={styles.emptyHint}>
              Откройте «Отчёт», выберите день в календаре «Итоги дня» и напишите несколько слов о нём.
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => navigation.navigate("DayNote", { date: item.date, title: formatDayLong(item.date) })}
          accessibilityRole="button"
          accessibilityLabel={`Итог за ${label(item.date)}`}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rowHead}>
            <Text style={styles.rowDate}>{label(item.date)}</Text>
            <Text style={styles.rowWeekday}>{weekdayLabel(item.date)}</Text>
          </View>
          <Text style={styles.rowText} numberOfLines={3}>
            {previewOf(item.text, 220)}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  count: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },

  row: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
  },
  rowHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  rowDate: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowWeekday: { color: colors.textMuted, fontSize: 11 },
  rowText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },

  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 12 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  emptyHint: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 8 },
});
