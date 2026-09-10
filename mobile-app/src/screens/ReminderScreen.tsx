import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, Switch, ScrollView, Linking, Platform, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import NotificationAccess from "../components/NotificationAccess";
import { PHASE_STEPS } from "../lib/phase";
import { phaseColors } from "../theme/colors";
import {
  getPhaseAlerts,
  setPhaseAlert,
  type PhaseAlerts,
} from "../notifications/phaseAlerts";
import {
  getReminderSettings,
  setReminderSettings,
  CHANNEL_BODIES,
  CHANNEL_LABELS,
  MAX_REMINDERS_PER_DAY,
  type ReminderChannel,
  type ReminderFailure,
  type ReminderSettings,
  type ReminderTime,
} from "../notifications/reminders";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Spreads a new slot away from the last one rather than stacking a second
 * reminder on the same minute, which is what a plain copy would do.
 */
function nextSlot(times: ReminderTime[]): ReminderTime {
  const last = times[times.length - 1] ?? { hour: 21, minute: 0 };
  return { hour: (last.hour + 3) % 24, minute: last.minute };
}

/**
 * Opens Android's battery-optimisation list. It is the only lever a person actually has over
 * the couple of minutes a scheduled notification drifts by: Android batches ordinary alarms
 * to avoid waking the processor for each one, and expo-notifications cannot ask for an exact
 * one at all.
 */
async function openBatterySettings(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    await Linking.sendIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
    return true;
  } catch {
    // Some vendors don't ship that screen; the app's own settings page is one tap from it.
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Что и когда присылает один раздел.
 *
 * Экран один на все три: у напоминаний Sterzhen, CaloriX и Creker разные слова и разное
 * время, но одна и та же механика — сколько раз в день и во сколько. Раздел приходит
 * параметром, а вместе с ним и то, чего у остальных нет: этапы бывают только у привычек.
 */
export default function ReminderScreen({
  route,
}: {
  route?: { params?: { channel?: ReminderChannel } };
}) {
  const channel: ReminderChannel = route?.params?.channel ?? "sterzhen";
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [alerts, setAlerts] = useState<PhaseAlerts | null>(null);
  const [failure, setFailure] = useState<{ kind: ReminderFailure; detail?: string } | null>(null);
  const [statusKey, setStatusKey] = useState(0);

  useEffect(() => {
    getReminderSettings().then(setSettings);
    getPhaseAlerts().then(setAlerts);
  }, []);

  const update = useCallback((next: ReminderSettings) => {
    setSettings(next); // optimistic, so the controls stay responsive
    setReminderSettings(next).then((applied) => {
      // If the OS refused, `enabled` comes back false — reflect that instead
      // of leaving a switch that claims reminders are on with nothing behind it.
      setSettings(applied.settings);
      setFailure(applied.failure ? { kind: applied.failure, detail: applied.detail } : null);
      // The scheduled count in the status block just changed.
      setStatusKey((k) => k + 1);
    });
  }, []);

  if (!settings || !alerts) return null;

  const own = settings.channels[channel];
  const patchChannel = (patch: Partial<typeof own>) =>
    update({ ...settings, channels: { ...settings.channels, [channel]: { ...own, ...patch } } });

  const patchTime = (index: number, patch: Partial<ReminderTime>) =>
    patchChannel({ times: own.times.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

  const bumpHour = (i: number, delta: number) =>
    patchTime(i, { hour: (own.times[i].hour + delta + 24) % 24 });
  const bumpMinute = (i: number, delta: number) =>
    patchTime(i, { minute: (own.times[i].minute + delta + 60) % 60 });

  const setCount = (count: number) => {
    const target = Math.min(MAX_REMINDERS_PER_DAY, Math.max(1, count));
    const times = [...own.times];
    while (times.length > target) times.pop();
    while (times.length < target) times.push(nextSlot(times));
    patchChannel({ times });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.subtle}>
        {`${CHANNEL_LABELS[channel]}: когда придёт напоминание и что в нём будет написано`}
      </Text>

      {/* Above the settings on purpose: a time picker is pointless if the OS
          isn't letting anything through, and that is the first thing to know. */}
      <NotificationAccess key={statusKey} onChanged={() => setStatusKey((k) => k + 1)} />

      <View style={styles.enableRow}>
        <Text style={styles.enableLabel}>Включено</Text>
        <Switch
          value={own.enabled}
          onValueChange={(enabled) => patchChannel({ enabled })}
          accessibilityLabel={`Включить напоминания ${CHANNEL_LABELS[channel]}`}
          trackColor={{ false: colors.cardBorder, true: colors.accentGreenDark }}
          thumbColor={colors.text}
        />
      </View>

      {own.enabled && !settings.enabled && (
        <Text style={styles.deniedNote}>
          Общий переключатель уведомлений выключен в настройках — пока он выключен, это
          напоминание не придёт.
        </Text>
      )}

      {failure && (
        <Text style={styles.deniedNote}>
          {failure.kind === "permission"
            ? "Уведомления запрещены в настройках системы — напоминание не придёт. Разреши их выше и включи снова."
            : `Не удалось поставить напоминание в расписание — на этом устройстве оно не сработает.${
                failure.detail ? ` Система ответила: ${failure.detail}` : ""
              }`}
        </Text>
      )}

      <View style={styles.countRow}>
        <Text style={styles.enableLabel}>Сколько раз в день</Text>
        <View style={styles.counter}>
          <Pressable
            onPress={() => setCount(own.times.length - 1)}
            disabled={own.times.length <= 1}
            accessibilityRole="button"
            accessibilityLabel="Меньше уведомлений в день"
            style={({ pressed }) => [
              styles.smallBtn,
              (pressed || own.times.length <= 1) && styles.dimmed,
            ]}
          >
            <Text style={styles.smallBtnText}>−</Text>
          </Pressable>
          <Text style={styles.countValue}>{own.times.length}</Text>
          <Pressable
            onPress={() => setCount(own.times.length + 1)}
            disabled={own.times.length >= MAX_REMINDERS_PER_DAY}
            accessibilityRole="button"
            accessibilityLabel="Больше уведомлений в день"
            style={({ pressed }) => [
              styles.smallBtn,
              (pressed || own.times.length >= MAX_REMINDERS_PER_DAY) && styles.dimmed,
            ]}
          >
            <Text style={styles.smallBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      {/* Every slot gets its own picker: spreading N reminders across the day
          automatically would mean guessing when your day starts. */}
      {own.times.map((time, i) => (
        <View key={i} style={styles.timeCard}>
          <View style={styles.timeHeader}>
            <Feather name="bell" size={14} color={colors.textMuted} />
            <Text style={styles.timeIndex}>Напоминание {i + 1}</Text>
          </View>
          <View style={styles.timeRow}>
            <View style={styles.timeUnit}>
              <Pressable
                onPress={() => bumpHour(i, 1)}
                accessibilityRole="button"
                accessibilityLabel={`Напоминание ${i + 1}: час +1`}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
              <Text style={styles.timeValue}>{pad(time.hour)}</Text>
              <Pressable
                onPress={() => bumpHour(i, -1)}
                accessibilityRole="button"
                accessibilityLabel={`Напоминание ${i + 1}: час −1`}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
            </View>
            <Text style={styles.colon}>:</Text>
            <View style={styles.timeUnit}>
              <Pressable
                onPress={() => bumpMinute(i, 5)}
                accessibilityRole="button"
                accessibilityLabel={`Напоминание ${i + 1}: минуты +5`}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
              <Text style={styles.timeValue}>{pad(time.minute)}</Text>
              <Pressable
                onPress={() => bumpMinute(i, -5)}
                accessibilityRole="button"
                accessibilityLabel={`Напоминание ${i + 1}: минуты −5`}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
            </View>
          </View>
          {/* What this one actually says. Left empty it uses the shared default, which is
              what every reminder said before they could be worded one by one. */}
          <TextInput
            value={time.text ?? ""}
            onChangeText={(text) => patchTime(i, { text })}
            placeholder={CHANNEL_BODIES[channel]}
            placeholderTextColor={colors.textMuted}
            multiline
            style={styles.textInput}
            accessibilityLabel={`Текст напоминания ${i + 1}`}
          />
        </View>
      ))}

      {channel === "sterzhen" && (
        <>
      <Text style={styles.sectionLabel}>Этапы</Text>
      <Text style={styles.subtle}>
        Приходит один раз за серию, когда начинается новый этап — при первом открытии
        приложения в этот день
      </Text>
      {PHASE_STEPS.map((step) => {
        const alert = alerts[step.id];
        const tint = phaseColors[step.id];
        return (
          <View key={step.id} style={styles.timeCard}>
            <View style={styles.phaseHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.phaseTitle, { color: tint }]}>{step.title}</Text>
                <Text style={styles.timeIndex}>{`придёт на ${step.fromDay}-й день серии`}</Text>
              </View>
              <Switch
                value={alert.enabled}
                onValueChange={(enabled) => setPhaseAlert(step.id, { enabled }).then(setAlerts)}
                accessibilityLabel={`Уведомление «${step.title}»`}
                trackColor={{ false: colors.cardBorder, true: colors.accentGreenDark }}
                thumbColor={colors.text}
              />
            </View>
            <TextInput
              value={alert.title}
              onChangeText={(title) => setAlerts({ ...alerts, [step.id]: { ...alert, title } })}
              onBlur={() => setPhaseAlert(step.id, { title: alert.title }).then(setAlerts)}
              style={[styles.textInput, styles.titleInput]}
              accessibilityLabel={`Заголовок уведомления «${step.title}»`}
            />
            <TextInput
              value={alert.body}
              onChangeText={(body) => setAlerts({ ...alerts, [step.id]: { ...alert, body } })}
              onBlur={() => setPhaseAlert(step.id, { body: alert.body }).then(setAlerts)}
              multiline
              style={styles.textInput}
              accessibilityLabel={`Текст уведомления «${step.title}»`}
            />
          </View>
        );
      })}
        </>
      )}

      {/* Said once, plainly, rather than left to be discovered as a bug: the app asks for a
          time and Android delivers around it. */}
      {Platform.OS === "android" && (
        <View style={styles.driftCard}>
          <Text style={styles.driftText}>
            Android может прислать уведомление на пару минут позже указанного времени — он
            собирает будильники в группы, чтобы реже будить процессор. Точное время системе
            не заказать. Сильные задержки обычно снимаются, если выключить экономию батареи
            для приложения.
          </Text>
          <Pressable
            onPress={openBatterySettings}
            accessibilityRole="button"
            style={({ pressed }) => [styles.batteryBtn, pressed && styles.dimmed]}
          >
            <Feather name="battery-charging" size={14} color={colors.text} />
            <Text style={styles.batteryBtnText}>Экономия батареи</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginTop: 24, marginBottom: 8 },
  phaseHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  phaseTitle: { fontSize: 15, fontWeight: "600" },
  textInput: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    minHeight: 44,
  },
  titleInput: { fontWeight: "600", minHeight: 0 },
  driftCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 24,
    gap: 12,
  },
  driftText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  batteryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 12,
  },
  batteryBtnText: { color: colors.text, fontSize: 13, fontWeight: "500" },
  subtle: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  enableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  enableLabel: { color: colors.text, fontSize: 15, fontWeight: "500" },
  deniedNote: { color: colors.accent, fontSize: 12, lineHeight: 17, marginTop: 10 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
  },
  counter: { flexDirection: "row", alignItems: "center", gap: 14 },
  smallBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  countValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 18,
    textAlign: "center",
  },
  dimmed: { opacity: 0.5 },
  timeCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
  },
  timeHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeIndex: { color: colors.textMuted, fontSize: 12 },
  timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 },
  timeUnit: { alignItems: "center", gap: 8 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  timeValue: { color: colors.text, fontSize: 30, fontWeight: "700", fontVariant: ["tabular-nums"] },
  colon: { color: colors.text, fontSize: 30, fontWeight: "700", marginBottom: 16 },
});
