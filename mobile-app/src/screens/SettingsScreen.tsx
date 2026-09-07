import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, AppState, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Application from "expo-application";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import { api, DEFAULT_SCREEN_TIME_LIMIT_MIN } from "../api/client";
import { colors } from "../theme/colors";
import { plural } from "../lib/plural";
import DataBackup from "../components/DataBackup";
import NotificationAccess from "../components/NotificationAccess";
import CrekerStatus from "../components/CrekerStatus";
import type { Habit } from "../types";
import { DEFAULT_DAY_RULE, describeDayRule, type DayRule } from "../lib/dayRule";
import { DEFAULT_SKIP_RULE, describeSkipRule, type SkipRule } from "../lib/skipRule";
import { habitsThatDecideTheDay } from "../lib/habits";
import { confirmDestructive } from "../lib/confirm";
import {
  getReminderSettings,
  getReminderStatus,
  type ReminderSettings,
  type ReminderStatus,
} from "../notifications/reminders";

/**
 * Everything that is a setting rather than a daily action, so the bottom bar
 * can go back to being six things you actually do. Reached from the gear in
 * the top-right of every screen.
 */

function Row({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * "Сборка 53" — the CI run number, taken from what the OS reports about the installed
 * package rather than from anything the JS bundle believes about itself.
 */
function buildLine(): string {
  const code = Application.nativeBuildVersion;
  const name = Application.nativeApplicationVersion;
  if (code) return `Сборка ${code}`;
  // Web, or a build where the native side has nothing to say.
  return name ? `Версия ${name}` : "Версия неизвестна";
}

function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

function describeReminder(settings: ReminderSettings | null, status: ReminderStatus | null): string {
  if (!settings || !status) return "Время, текст и уведомления об этапах";
  if (!settings.enabled) return "Выключено";
  if (status.permission !== "granted") return "Включено, но система не пропускает уведомления";
  const n = settings.times.length;
  const word = n === 1 ? "раз" : n < 5 ? "раза" : "раз";
  return `${n} ${word} в день · ${settings.times.map((t) => `${pad(t.hour)}:${pad(t.minute)}`).join(", ")} · плюс этапы`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function SettingsScreen({ navigation }: { navigation: { navigate: (screen: string) => void } }) {
  const qc = useQueryClient();

  // Not react-query: these come from the OS and from a non-KEYS storage entry,
  // and they change while you are away on the reminder screen or in the system
  // settings, so they are re-read whenever this screen comes back into focus.
  const [reminder, setReminder] = useState<ReminderSettings | null>(null);
  const [notifStatus, setNotifStatus] = useState<ReminderStatus | null>(null);

  const refreshReminder = useCallback(() => {
    getReminderSettings().then(setReminder);
    getReminderStatus().then(setNotifStatus);
  }, []);

  useEffect(() => {
    // Returning from the system settings changes the answer, and nothing
    // inside the app would say so.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshReminder();
    });
    return () => sub.remove();
  }, [refreshReminder]);

  // Navigating back from the reminder screen isn't an AppState change, so this
  // covers the far more common case of editing the times and coming back.
  useFocusEffect(refreshReminder);

  // Both rules, for the row's hint: what is behind a door should say what it is set to,
  // otherwise the only way to check is to open it.
  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: dayRule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });
  const { data: skipRule = DEFAULT_SKIP_RULE } = useQuery<SkipRule>({
    queryKey: ["skipRule"],
    queryFn: () => api.getSkipRule(),
  });
  const adminHint = `${describeDayRule(dayRule, habitsThatDecideTheDay(habits).length)} · ${describeSkipRule(skipRule)}`;

  /**
   * One question before the rules open.
   *
   * Not a lock: a code you set for yourself and then forget costs you your own settings,
   * which is a worse failure than the one it guards against. A pause is enough — the point
   * is to not walk in by accident on the evening the day went badly, which is exactly when
   * lowering the bar is most tempting and least useful.
   */
  const openAdmin = () =>
    confirmDestructive(
      "Открыть настройки админа?",
      "Здесь меняются правила зачёта дня и пропусков. Обе пересчитывают прошлое: числа в отчёте сдвинутся сразу. Сейчас подходящий момент их менять?",
      () => navigation.navigate("Admin"),
      "Открыть",
      false,
    );

  // Just the count for the row's hint — the screen itself loads the marks.
  const { data: archived = [] } = useQuery<Habit[]>({
    queryKey: ["archivedHabits"],
    queryFn: () => api.getArchivedHabits() as Promise<Habit[]>,
  });
  const archiveHint =
    archived.length === 0
      ? "Пусто — сюда попадают привычки, убранные из чек-листа"
      : `${archived.length} ${plural(archived.length, ["убранная привычка", "убранные привычки", "убранных привычек"])}`;

  const reminderHint = describeReminder(reminder, notifStatus);

  // The limit behind the "Экранное время в норме" habit was hardcoded at three
  // hours with nowhere to change it — the value existed in storage but no
  // screen ever wrote to it.
  const { data: limit = DEFAULT_SCREEN_TIME_LIMIT_MIN } = useQuery<number>({
    queryKey: ["screenTimeLimit"],
    queryFn: () => api.getScreenTimeLimitMinutes(),
  });

  const setLimit = useMutation({
    mutationFn: (minutes: number) => api.setScreenTimeLimitMinutes(minutes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenTimeLimit"] });
      // The habit is auto-ticked against this number, so today's verdict can
      // change the moment it moves.
      qc.invalidateQueries({ queryKey: ["habitLog"] });
    },
  });

  // 30 min ≤ limit ≤ 12 h: below half an hour the habit could never be met,
  // above twelve it stops meaning anything.
  const bump = (delta: number) => setLimit.mutate(Math.min(720, Math.max(30, limit + delta)));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.sectionLabel}>Справочник</Text>
      <Row
        label="Подсказки"
        hint="Всё, к чему подталкивает приложение, и почему"
        onPress={() => navigation.navigate("Library")}
      />
      <Row
        label="Архив привычек"
        hint={archiveHint}
        onPress={() => navigation.navigate("Archive")}
      />

      <Row
        label="Настройки админа"
        hint={adminHint}
        onPress={openAdmin}
      />

      <Text style={[styles.sectionLabel, styles.spaced]}>Уведомления</Text>
      {/* The status block sits here as well as on the reminder screen: whether
          the OS lets anything through is the first thing worth knowing, and
          the switch alone never said. */}
      <NotificationAccess onChanged={refreshReminder} />
      <View style={{ height: 10 }} />
      <Row
        label="Что и когда приходит"
        hint={reminderHint}
        onPress={() => navigation.navigate("Reminder")}
      />

      <Text style={[styles.sectionLabel, styles.spaced]}>Creker</Text>
      {/* The habit below ticks itself from creker's numbers, and every way that can
          fail looks the same on the checklist — an unticked box. This says which
          failure it is before the limit under it is worth adjusting. */}
      <CrekerStatus />

      <Text style={[styles.sectionLabel, styles.spaced]}>Экранное время</Text>
      <View style={styles.limitCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Дневной лимит</Text>
          <Text style={styles.rowHint}>
            Привычка «Экранное время в норме» отмечается сама, если Creker насчитал меньше
          </Text>
        </View>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => bump(-30)}
            accessibilityRole="button"
            accessibilityLabel="Уменьшить лимит"
            style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <Text style={styles.limitValue}>{formatMinutes(limit)}</Text>
          <Pressable
            onPress={() => bump(30)}
            accessibilityRole="button"
            accessibilityLabel="Увеличить лимит"
            style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.spaced}>
        <DataBackup />
      </View>

      {/* Last, small, and easy to read out loud. Every build used to call itself 1.0.0, so
          "which version are you on" — the first question when something behaves like a bug
          that was already fixed — had no answer anywhere on the device. */}
      <Text style={styles.version}>{buildLine()}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  version: { color: colors.textMuted, fontSize: 11, textAlign: "center", marginTop: 28 },
  spaced: { marginTop: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  pressed: { opacity: 0.75 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  limitCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 12,
  },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: "600" },
  limitValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 90,
    textAlign: "center",
  },
});
