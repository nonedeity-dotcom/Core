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
 * Строка периода: стрелка, название, стрелка.
 *
 * Пресеты убраны с экрана в саму эту кнопку. Ряд из четырёх чипов стоял над каждым экраном
 * постоянно, а нажимают его редко: период выбирают один раз и потом листают. Теперь наверху
 * одна строка, которая говорит, что показано, и открывает выбор, когда он нужен.
 *
 * Стрелки двигают окно целиком, а не на день: «неделю назад» — это прошлая неделя. Пресет
 * при этом перестаёт быть пресетом, иначе ближайшая полночь утащила бы диапазон обратно к
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
  const [open, setOpen] = useState(false);
  const range = resolveSelection(selection, today);
  const span = dayCount(range);

  return (
    <>
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

        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Период: ${describeRange(range, today)}. Нажми, чтобы выбрать`}
          style={({ pressed }) => [styles.label, pressed && styles.pressed]}
        >
          <Text style={styles.labelText}>{describeRange(range, today)}</Text>
          <Feather name="chevron-down" size={14} color={colors.textMuted} />
        </Pressable>

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

      <PeriodPicker
        visible={open}
        selection={selection}
        range={range}
        today={today}
        onClose={() => setOpen(false)}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * Выбор периода: четыре готовых и свой.
 *
 * Свой набирается полями, а не календарём: календарь на два месяца — отдельный экран со
 * своей вёрсткой, а попадают сюда редко и обычно зная дату. Ввод проверяется до того, как
 * его примут: концы переставляются местами, будущее обрезается по сегодня, мусор просто не
 * даёт нажать.
 */
function PeriodPicker({
  visible,
  selection,
  range,
  today,
  onClose,
  onPick,
}: {
  visible: boolean;
  selection: Selection;
  range: DayRange;
  today: string;
  onClose: () => void;
  onPick: (selection: Selection) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const picked = isDate(from) && isDate(to) ? normalize(from, to, today) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть">
        <Pressable style={styles.panel} onPress={() => {}}>
          <Text style={styles.panelTitle}>Период</Text>

          {PRESETS.map((preset) => {
            const on = !custom && selection.kind === "preset" && selection.preset === preset;
            return (
              <Pressable
                key={preset}
                onPress={() => onPick({ kind: "preset", preset })}
                accessibilityRole="button"
                accessibilityLabel={`Период: ${PRESET_LABELS[preset]}`}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
              >
                <Text style={[styles.optionText, on && styles.optionTextOn]}>{PRESET_LABELS[preset]}</Text>
                {on && <Feather name="check" size={15} color={colors.accentGreen} />}
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => setCustom((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Любой период"
            style={({ pressed }) => [
              styles.option,
              (custom || selection.kind === "fixed") && styles.optionOn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.optionText, (custom || selection.kind === "fixed") && styles.optionTextOn]}>
              Любой период
            </Text>
            <Feather name={custom ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} />
          </Pressable>

          {custom && (
            <View style={styles.customBox}>
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
                  : "Нужны две даты вида 2026-09-01"}
              </Text>
              <Pressable
                onPress={() => picked && onPick({ kind: "fixed", range: picked })}
                disabled={!picked}
                accessibilityRole="button"
                accessibilityLabel="Показать период"
                style={({ pressed }) => [styles.primary, !picked && styles.primaryOff, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>Показать</Text>
              </Pressable>
            </View>
          )}

          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Закрыть</Text>
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
  nav: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  navBtnOff: { opacity: 0.3 },
  label: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.card,
  },
  labelText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.75 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  panel: { backgroundColor: colors.card, borderRadius: 18, padding: 16 },
  panelTitle: { color: colors.text, fontSize: 15, fontWeight: "600", marginBottom: 10 },
  panelHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.bg,
    marginBottom: 6,
  },
  optionOn: { backgroundColor: "rgba(143,184,154,0.12)" },
  optionText: { color: colors.text, fontSize: 14 },
  optionTextOn: { color: colors.accentGreen, fontWeight: "600" },
  customBox: { marginTop: 4 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, marginTop: 10, marginBottom: 4 },
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
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.accentGreenDark,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  cancel: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  cancelText: { color: colors.textMuted, fontSize: 13 },
});
