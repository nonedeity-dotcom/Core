import { Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { colors } from "../theme/colors";

/**
 * Вкладки раздела — строкой чипов наверху.
 *
 * Внизу теперь стоят разделы, и второй полосе там места нет. Наверху вкладкам и лучше: их
 * переключают заметно реже, чем сам раздел, а чип — это тот же переключатель, которым в
 * приложении выбирают всё остальное, от сложности игры до уровня привычки.
 *
 * Строка прокручивается, потому что в Стержне вкладок пять, а «Статистика» — самое длинное
 * слово в приложении: пять таких в ширину телефона не влезают, и ужимать их до трёх букв
 * хуже, чем дать сдвинуть пальцем.
 */
export default function TabChips({
  titles,
  index,
  onChange,
}: {
  titles: string[];
  index: number;
  onChange: (index: number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.strip}
    >
      {titles.map((title, i) => {
        const on = i === index;
        return (
          <Pressable
            key={title}
            onPress={() => onChange(i)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
          >
            <Text style={[styles.text, on && styles.textOn]}>{title}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // flexGrow: 0 обязателен: ScrollView внутри колонки иначе растягивается на весь экран и
  // отбирает высоту у того, ради чего он здесь стоит.
  strip: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  row: { gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  pressed: { opacity: 0.7 },
  text: { color: colors.textMuted, fontSize: 13 },
  textOn: { color: colors.accentGreen, fontWeight: "600" },
});
