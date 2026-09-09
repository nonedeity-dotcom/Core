import { useState } from "react";
import { View, Text, TextInput, Pressable, Modal, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import {
  PRESET_LABELS,
  dayCount,
  describeRange,
  resolveSelection,
  shiftRange,
  type DayRange,
  type Preset,
  type Selection,
} from "../../lib/screen/period";

const PRESETS: Preset[] = ["day", "yesterday", "week", "month"];

/**
 * Выбор периода: пресеты, шаг окном и произвольный диапазон.
 *
 * Шаг двигает окно целиком, а не на день: «неделю назад» — это прошлая неделя. При этом
 * пресет перестаёт быть пресетом, иначе следующая полночь утащила бы диапазон обратно к
 * «сегодня», и человек оказался бы не там, куда пролистал.
 */
export default function PeriodBar({
  selection,
  onChange,
  today,
}: {
  selection: Selection;
  onChange: (selection: Selection) => void;
  today: string;
}) {
  const [custom, setCustom] = useState(false);
  const range = resolveSelection(selection, today);
  const span = dayCount(range);

  return (
    <>
      <View style={styles.presets}>
        {PRESETS.map((preset) => {
          const on = selection.kind === "preset" && selection.preset === preset;
          return (
            <Pressable
              key={preset}
              onPress={() => onChange({ kind: "preset", preset })}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Период: ${PRESET_LABELS[preset]}`}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{PRESET_LABELS[preset]}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setCustom(true)}
          accessibilityRole="button"
          accessibilityLabel="Свой период"
          style={({ pressed }) => [
            styles.chip,
            selection.kind === "fixed" && styles.chipOn,
            pressed && styles.pressed,
          ]}
        >
          <Feather
            name="calendar"
            size={12}
            color={selection.kind === "fixed" ? colors.accentGreen : colors.textMuted}
          />
        </Pressable>
      </View>

      <View style={styles.nav}>
        <Pressable
          onPress={() => onChange({ kind: "fixed", range: shiftRange(range, -span) })}
          accessibilityRole="button"
          accessibilityLabel="Предыдущий период"
          hitSlop={10}
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
        >
          <Feather name="chevron-left" size={18} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.rangeLabel}>{describeRange(range, today)}</Text>
        <Pressable
          onPress={() => onChange({ kind: "fixed", range: shiftRange(range, span) })}
          disabled={range.to >= today}
          accessibilityRole="button"
          accessibilityLabel="Следующий период"
          hitSlop={10}
          style={({ pressed }) => [styles.navBtn, range.to >= today && styles.navBtnOff, pressed && styles.pressed]}
        >
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <CustomRange
        visible={custom}
        initial={range}
        today={today}
        onClose={() => setCustom(false)}
        onPick={(picked) => {
          onChange({ kind: "fixed", range: picked });
          setCustom(false);
        }}
      />
    </>
  );
}

/**
 * Произвольный диапазон, набираемый вручную.
 *
 * Поля, а не календарь: календарь на два месяца — это отдельный экран со своей вёрсткой, а
 * попадают сюда редко и обычно зная дату. Ввод проверяется до того, как его примут: концы
 * переставляются местами, будущее обрезается по сегодня, мусор просто не даёт нажать.
 */
function CustomRange({
  visible,
  initial,
  today,
  onClose,
  onPick,
}: {
  visible: boolean;
  initial: DayRange;
  today: string;
  onClose: () => void;
  onPick: (range: DayRange) => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid = isDate(from) && isDate(to);
  const picked = valid ? normalize(from, to, today) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть">
        <Pressable style={styles.panel} onPress={() => {}}>
          <Text style={styles.panelTitle}>Свой период</Text>
          <Text style={styles.panelHint}>Даты в виде 2026-09-01</Text>

          <Text style={styles.fieldLabel}>С какого дня</Text>
          <TextInput
            value={from}
            onChangeText={setFrom}
            placeholder="2026-09-01"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            accessibilityLabel="Начало периода"
          />
          <Text style={styles.fieldLabel}>По какой</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder={today}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            accessibilityLabel="Конец периода"
          />

          <Text style={styles.panelHint}>
            {picked
              ? `${picked.from} — ${picked.to}, ${dayCount(picked)} дн.`
              : "Пока не разобрать: нужны две даты вида 2026-09-01"}
          </Text>

          <Pressable
            onPress={() => picked && onPick(picked)}
            disabled={!picked}
            accessibilityRole="button"
            accessibilityLabel="Показать период"
            style={({ pressed }) => [styles.primary, !picked && styles.primaryOff, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Показать</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

/** Концы по порядку, конец не дальше сегодня: обратный диапазон — описка, а не запрос. */
function normalize(from: string, to: string, today: string): DayRange {
  const a = from.trim();
  const b = to.trim();
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  return { from: start, to: end > today ? today : end };
}

const styles = StyleSheet.create({
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    justifyContent: "center",
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  nav: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  navBtnOff: { opacity: 0.3 },
  rangeLabel: { flex: 1, textAlign: "center", color: colors.text, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.75 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  panel: { backgroundColor: colors.card, borderRadius: 18, padding: 18 },
  panelTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  panelHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  primary: {
    marginTop: 16,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.accentGreenDark,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  cancel: { alignItems: "center", paddingVertical: 10 },
  cancelText: { color: colors.textMuted, fontSize: 13 },
});
