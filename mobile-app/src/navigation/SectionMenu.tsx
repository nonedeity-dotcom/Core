import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";

export type Section = "home" | "sterzhen" | "balance" | "screen";

/**
 * Меню разделов — то, что открывается кнопкой «три линии» слева в шапке.
 *
 * Своя панель в модальном окне, а не настоящий drawer из react-navigation: тот тянет за
 * собой reanimated и gesture-handler, две нативные зависимости в сборку, которую нельзя
 * проверить нигде, кроме телефона. Разница ровно одна — открывается кнопкой, а не свайпом
 * от края; для списка из трёх пунктов это не потеря.
 */
export default function SectionMenu({
  visible,
  section,
  onClose,
  onSelect,
  onSettings,
}: {
  visible: boolean;
  section: Section;
  onClose: () => void;
  onSelect: (section: Section) => void;
  /** Настройки живут здесь же, внизу: это не раздел, а то, что настраивает все три. */
  onSettings: () => void;
}) {
  const sections: { id: Section; title: string; hint: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
    // Главная первой: она про сегодняшний день целиком, а разделы — про его части.
    { id: "home", title: "Главная", hint: "Общая картина за сегодня", icon: "home" },
    { id: "sterzhen", title: "Sterzhen", hint: "Привычки, фокус, энергия", icon: "check-square" },
    { id: "balance", title: "CaloriX", hint: "Калории и белок за день", icon: "pie-chart" },
    { id: "screen", title: "Creker", hint: "Сколько времени и в чём", icon: "smartphone" },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Тап мимо панели закрывает — единственный жест, которого от такого меню ждут. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть меню">
        <Pressable style={styles.panel} onPress={() => {}}>
          <Text style={styles.title}>Разделы</Text>

          {sections.map((s) => {
            const active = s.id === section;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  onSelect(s.id);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}
              >
                <Feather name={s.icon} size={18} color={active ? colors.accentGreen : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, active && styles.rowTitleActive]}>{s.title}</Text>
                  <Text style={styles.rowHint}>{s.hint}</Text>
                </View>
                {active && <Feather name="check" size={16} color={colors.accentGreen} />}
              </Pressable>
            );
          })}

          <View style={styles.divider} />
          {/* Внизу и без выделения: настройки открывают редко, а разделы — каждый раз. */}
          <Pressable
            onPress={() => {
              onSettings();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Настройки"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Feather name="settings" size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Настройки</Text>
              <Text style={styles.rowHint}>Уведомления, данные и правила — для всех трёх</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.textMuted} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  panel: {
    width: "82%",
    maxWidth: 320,
    height: "100%",
    backgroundColor: colors.card,
    paddingTop: 56,
    paddingHorizontal: 16,
    borderRightWidth: 1,
    borderRightColor: colors.cardBorder,
  },
  title: { color: colors.textMuted, fontSize: 12, marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginBottom: 6,
  },
  rowActive: { backgroundColor: "rgba(143,184,154,0.12)" },
  pressed: { opacity: 0.75 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowTitleActive: { color: colors.accentGreen, fontWeight: "600" },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginVertical: 10 },
});
