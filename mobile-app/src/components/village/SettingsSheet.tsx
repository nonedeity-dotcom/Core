import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { VillageSettings } from "../../lib/village/settings";
import { dayOf, type VillageState } from "../../lib/village/game";
import { GOALS } from "../../lib/village/content";

type FeatherName = ComponentProps<typeof Feather>["name"];

/**
 * Настройки «Опушки».
 *
 * Всё меняется сразу, без кнопки «сохранить»: переключил джойстик на крестовину — закрыл —
 * играешь. Настройки этого телефона, не мира.
 */
export default function SettingsSheet({
  settings,
  state,
  side,
  onChange,
  onClose,
  onNewWorld,
}: {
  settings: VillageSettings;
  state: VillageState;
  side: boolean;
  onChange: (next: VillageSettings) => void;
  onClose: () => void;
  onNewWorld: () => void;
}) {
  const set = <K extends keyof VillageSettings>(key: K, value: VillageSettings[K]) => onChange({ ...settings, [key]: value });

  // Новый мир — только со второго нажатия: одним случайным касанием месяцы игры не стираются.
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const id = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(id);
  }, [arming]);

  const built = Object.keys(state.built).length;
  const gathered = Object.values(state.gathered).reduce((n, v) => n + (v ?? 0), 0);

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть настройки" />
      <View style={[styles.sheet, side ? styles.sheetSide : styles.sheetBottom]}>
        <View style={styles.head}>
          <Feather name="settings" size={18} color={colors.text} />
          <Text style={styles.title}>Настройки игры</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть" hitSlop={12} style={styles.close}>
            <Feather name="x" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
          <Section icon="move" title="Управление" />
          <Choice
            label="Как ходить"
            value={settings.control}
            options={[
              ["stick", "Джойстик"],
              ["dpad", "Крестовина"],
              ["tap", "Касанием"],
            ]}
            onPick={(v) => set("control", v)}
          />
          <Text style={styles.hint}>
            {settings.control === "stick"
              ? "Держи палец на круге и веди в нужную сторону — можно поворачивать, не отпуская."
              : settings.control === "dpad"
                ? "Четыре стрелки на одном круге: палец можно переводить со стрелки на стрелку."
                : "Кнопок для ходьбы нет: нажми на клетку карты, и персонаж дойдёт сам."}
          </Text>
          {settings.control !== "tap" && (
            <>
              <Choice
                label="Где джойстик"
                value={settings.padSide}
                options={[
                  ["left", "Слева"],
                  ["right", "Справа"],
                ]}
                onPick={(v) => set("padSide", v)}
              />
              <Toggle
                label="Ходить нажатием на карту"
                hint="Нажал на клетку — дошёл сам, нажал на дерево — подошёл к нему"
                value={settings.tapToWalk}
                onChange={(v) => set("tapToWalk", v)}
              />
            </>
          )}
          <Choice
            label="Скорость ходьбы"
            value={settings.speed}
            options={[
              ["slow", "Спокойно"],
              ["normal", "Обычно"],
              ["fast", "Быстро"],
            ]}
            onPick={(v) => set("speed", v)}
          />
          <Choice
            label="Размер кнопок"
            value={settings.buttons}
            options={[
              ["small", "Меньше"],
              ["normal", "Обычные"],
              ["large", "Крупнее"],
            ]}
            onPick={(v) => set("buttons", v)}
          />

          <Section icon="volume-2" title="Звук" />
          <Toggle label="Звуки" hint="Шаги, топор, ягоды, ремесло, сон" value={settings.sound} onChange={(v) => set("sound", v)} />
          <Toggle
            label="Звуки леса"
            hint="Днём ветер и птицы, ночью сверчки"
            value={settings.ambience}
            onChange={(v) => set("ambience", v)}
          />
          {(settings.sound || settings.ambience) && (
            <Choice
              label="Громкость"
              value={settings.volume}
              options={[
                ["quiet", "Тихо"],
                ["normal", "Средне"],
                ["loud", "Громко"],
              ]}
              onPick={(v) => set("volume", v)}
            />
          )}
          <Toggle
            label="Вибрация"
            hint="Лёгкий отклик, когда что-то собрал или построил"
            value={settings.vibration}
            onChange={(v) => set("vibration", v)}
          />

          <Section icon="monitor" title="Экран" />
          <Choice
            label="Как держать телефон"
            value={settings.landscape ? "l" : "p"}
            options={[
              ["p", "Вертикально"],
              ["l", "Горизонтально"],
            ]}
            onPick={(v) => set("landscape", v === "l")}
          />
          <Toggle label="Показывать задачу" hint="Строка с подсказкой, что делать дальше" value={settings.showGoal} onChange={(v) => set("showGoal", v)} />
          <Toggle
            label="Рамка перед персонажем"
            hint="Подсвечивает клетку, к которой относится кнопка действия"
            value={settings.showTarget}
            onChange={(v) => set("showTarget", v)}
          />

          <Section icon="globe" title="Мир" />
          <View style={styles.stats}>
            <Stat label="День" value={String(dayOf(state.time))} />
            <Stat label="Задачи" value={`${state.goalsDone.length}/${GOALS.length}`} />
            <Stat label="Собрано" value={String(gathered)} />
            <Stat label="Построек" value={String(built)} />
          </View>
          <Pressable
            onPress={() => (arming ? (setArming(false), onNewWorld()) : setArming(true))}
            accessibilityRole="button"
            accessibilityLabel="Начать новый мир"
            style={({ pressed }) => [styles.danger, arming && styles.dangerArmed, pressed && styles.pressed]}
          >
            <Feather name="refresh-ccw" size={15} color={arming ? colors.bg : colors.accent} />
            <Text style={[styles.dangerText, arming && styles.dangerTextArmed]}>
              {arming ? "Точно? Нажми ещё раз — этот мир пропадёт" : "Начать новый мир"}
            </Text>
          </Pressable>
          <Text style={styles.hint}>Новый лес, новая поляна, пустая сумка. Настройки остаются.</Text>
        </ScrollView>
      </View>
    </>
  );
}

function Section({ icon, title }: { icon: FeatherName; title: string }) {
  return (
    <View style={styles.section}>
      <Feather name={icon} size={14} color={colors.accentGreen} />
      <Text style={styles.sectionText}>{title}</Text>
    </View>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segment}>
        {options.map(([v, text]) => (
          <Pressable
            key={v}
            onPress={() => onPick(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: v === value }}
            accessibilityLabel={`${label}: ${text}`}
            style={[styles.seg, v === value && styles.segOn]}
          >
            <Text style={[styles.segText, v === value && styles.segTextOn]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.cardBorder, true: colors.accentGreenDark }}
        thumbColor={value ? colors.accentGreen : colors.textMuted}
      />
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", backgroundColor: colors.bg, borderColor: colors.cardBorder, paddingHorizontal: 16, paddingTop: 14 },
  sheetBottom: { left: 0, right: 0, bottom: 0, top: "14%", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1 },
  sheetSide: { right: 0, top: 0, bottom: 0, width: "52%", borderLeftWidth: 1, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  pressed: { opacity: 0.7 },

  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "700" },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },

  section: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18, marginBottom: 8 },
  sectionText: { color: colors.accentGreen, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },

  row: { backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 8, gap: 10 },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  segment: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: 11, padding: 3 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segOn: { backgroundColor: colors.accentGreen },
  segText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  segTextOn: { color: colors.bg },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 8, marginHorizontal: 4 },

  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  toggleHint: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  stats: { flexDirection: "row", gap: 8, marginBottom: 10 },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 10, alignItems: "center" },
  statValue: { color: colors.text, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2 },

  danger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(224,138,85,0.45)",
    marginBottom: 6,
  },
  dangerArmed: { backgroundColor: colors.accent, borderColor: colors.accent },
  dangerText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  dangerTextArmed: { color: colors.bg },
});
