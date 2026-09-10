import { useCallback, useEffect, useState } from "react";
import { View, Text, AppState, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { getCrekerConnection, type CrekerConnection } from "../../modules/creker-usage";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { decideScreenTimeHabit } from "../lib/screenTime";
import { todayKey } from "../lib/date";

/**
 * Whether the link to creker actually works, in plain words.
 *
 * The screen-time habit ticks itself silently or not at all, and every reason it might
 * not — creker missing, creker refusing this app, creker behind on measuring — looks
 * identical from the checklist: an unticked box. This is the one place that says which
 * of them it is, and therefore where to go and fix it.
 */
export default function CrekerStatus() {
  const [connection, setConnection] = useState<CrekerConnection | null>(null);
  const [limitMin, setLimitMin] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const date = todayKey();
    getCrekerConnection(date).then(setConnection);
    api.getScreenTimeLimitMinutes().then(setLimitMin);
  }, []);

  useEffect(() => {
    refresh();
    // Allowing this app in creker's settings happens in creker, so the answer changes
    // while we're in the background and nothing here would otherwise notice.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (!connection) return null;

  const { title, hint, ok } = describe(connection, limitMin);

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <Feather
          name={ok ? "check-circle" : "alert-circle"}
          size={18}
          color={ok ? colors.accentGreen : colors.accent}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusText, { color: ok ? colors.accentGreen : colors.accent }]}>{title}</Text>
          <Text style={styles.statusHint}>{hint}</Text>
        </View>
      </View>
    </View>
  );
}

function describe(
  connection: CrekerConnection,
  limitMin: number | null,
): { title: string; hint: string; ok: boolean } {
  switch (connection.state) {
    case "not-installed":
      return {
        title: "Creker не установлен",
        ok: false,
        hint: "Это отдельное приложение, которое считает экранное время. Без него привычку «Экранное время в норме» придётся отмечать вручную.",
      };
    case "refused":
      return {
        title: "Creker не отдаёт данные",
        ok: false,
        hint: "Он установлен, но не отвечает на запросы. Открой Creker → шестерёнка → «Данные другим приложениям» и включи «Sterzhen».",
      };
    case "silent":
      return {
        title: "Creker установлен, но молчит",
        ok: false,
        hint: "Запрос не прошёл. Обычно помогает открыть Creker хотя бы раз после установки.",
      };
    case "connected": {
      if (connection.screenMillis == null) {
        return {
          title: "Связь есть, данных за сегодня пока нет",
          ok: false,
          hint: "Creker отвечает, но сегодняшний день ещё не посчитан. Проверь в нём доступ к статистике использования.",
        };
      }
      const verdict = decideScreenTimeHabit(
        { screenMillis: connection.screenMillis, updatedAt: connection.updatedAt ?? 0 },
        limitMin ?? 0,
        Date.now(),
        todayKey(),
      );
      const measured = formatDuration(connection.screenMillis);
      return {
        title: "Связь есть",
        ok: verdict.action === "tick",
        hint:
          verdict.action === "tick"
            ? `Сегодня насчитано ${measured} — этого хватает, чтобы привычка отмечалась сама.`
            : `Сегодня насчитано ${measured}, но данные не досчитаны до текущего момента — пока их мало, отметка остаётся ручной.`,
      };
    }
  }
}

function formatDuration(millis: number): string {
  const totalMin = Math.round(millis / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  statusText: { fontSize: 14, fontWeight: "600" },
  statusHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
});
