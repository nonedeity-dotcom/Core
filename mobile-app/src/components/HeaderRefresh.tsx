import { useState } from "react";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { todayKey } from "../lib/date";
import { syncScreenTimeHabit } from "../integrations/screenTime";
import type { Habit } from "../types";

/**
 * Re-read everything, by hand.
 *
 * Almost nothing in this app can go stale: there is no server, and every write invalidates
 * what it touched. The exception is creker, which lives in another app and is only read
 * when the checklist first mounts — so an hour of screen time racked up while this app sat
 * open in the background is invisible until you restart it. That is what this button is
 * really for; refetching the local caches on the way is free.
 *
 * It holds the "working" state for a moment even when the answer comes back instantly,
 * because a button that flickers and shows nothing reads as a button that does nothing.
 */
export default function HeaderRefresh() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    const settle = new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const habits = (await api.getHabits()) as Habit[];
      if (habits.length > 0) await syncScreenTimeHabit(habits, todayKey());
      await qc.invalidateQueries();
    } finally {
      await settle;
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={refresh}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Обновить"
      accessibilityState={{ busy }}
      hitSlop={12}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Feather name="refresh-cw" size={18} color={busy ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}
