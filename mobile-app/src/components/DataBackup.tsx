import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { colors } from "../theme/colors";
import { confirmDestructive } from "../lib/confirm";
import { formatDateShort } from "../lib/date";
import { plural } from "../lib/plural";
import {
  applyBackup,
  backupFileName,
  buildBackupText,
  BackupError,
  parseBackupText,
  type ImportMode,
  type ParsedBackup,
} from "../lib/backup";
import { saveTextFile, pickTextFile } from "../lib/backupFile";
import type { ImportStats } from "../api/client";

type Busy = null | "export" | "import";
type Note = { tone: "ok" | "error"; text: string };

function summarise(p: ParsedBackup): string {
  const { habits, habitLog, sessions } = p.data;
  const parts = [
    `${habits.length} ${plural(habits.length, ["привычка", "привычки", "привычек"])}`,
    `${habitLog.length} ${plural(habitLog.length, ["отметка", "отметки", "отметок"])}`,
    `${sessions.length} ${plural(sessions.length, ["сессия", "сессии", "сессий"])}`,
  ];
  const when = p.exportedAt ? `Копия от ${formatDateShort(p.exportedAt)}` : "Копия";
  return `${when}: ${parts.join(", ")}`;
}

function describeImport(stats: ImportStats, mode: ImportMode): string {
  if (mode === "replace") {
    return `Данные заменены: ${stats.habits} ${plural(stats.habits, ["привычка", "привычки", "привычек"])}, ${
      stats.habitLog
    } ${plural(stats.habitLog, ["отметка", "отметки", "отметок"])}.`;
  }
  const added = stats.habits + stats.habitLog + stats.sessions + stats.energy + stats.rewards;
  if (added === 0) return "Всё из этого файла уже есть — ничего не изменилось.";
  return `Добавлено: ${stats.habits} ${plural(stats.habits, ["привычка", "привычки", "привычек"])}, ${
    stats.habitLog
  } ${plural(stats.habitLog, ["отметка", "отметки", "отметок"])}, ${stats.sessions} ${plural(stats.sessions, [
    "сессия",
    "сессии",
    "сессий",
  ])}.`;
}

/**
 * Export/import for the whole local database.
 *
 * Everything lives in AsyncStorage on one device, so uninstalling the app or
 * changing phones threw away the entire history with no way to get it back.
 * This is that way: one JSON file out, the same file back in.
 */
export default function DataBackup() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const onExport = async () => {
    setBusy("export");
    setNote(null);
    try {
      const name = backupFileName();
      const result = await saveTextFile(name, await buildBackupText());
      setNote({
        tone: "ok",
        text:
          result.status === "saved"
            ? `Файл ${name} сохранён.`
            : `Файл ${name} готов — выбери, куда его положить.`,
      });
    } catch (e) {
      setNote({ tone: "error", text: `Не удалось сохранить файл: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const onPick = async () => {
    setBusy("import");
    setNote(null);
    setPending(null);
    try {
      const text = await pickTextFile();
      if (text === null) return; // picker dismissed — not an error, say nothing
      setPending(parseBackupText(text));
    } catch (e) {
      // A BackupError already carries a sentence meant for the user; anything
      // else is unexpected and shows its raw message rather than a shrug.
      setNote({
        tone: "error",
        text: e instanceof BackupError ? e.message : `Не удалось прочитать файл: ${(e as Error).message}`,
      });
    } finally {
      setBusy(null);
    }
  };

  const run = async (mode: ImportMode) => {
    if (!pending) return;
    setBusy("import");
    try {
      const stats = await applyBackup(pending, mode);
      setPending(null);
      setNote({ tone: "ok", text: describeImport(stats, mode) });
      // Every screen reads through react-query, so nothing on screen would
      // change until the caches are dropped.
      await qc.invalidateQueries();
    } catch (e) {
      setNote({ tone: "error", text: `Не удалось загрузить данные: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const onReplace = () => {
    if (!pending) return;
    confirmDestructive(
      "Заменить все данные?",
      "Привычки, отметки, сессии и заметки на этом телефоне будут стёрты и заменены содержимым файла. Отменить это будет нечем.",
      () => void run("replace"),
      "Заменить",
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>Данные</Text>
      <Text style={styles.subtle}>
        Всё хранится только на этом телефоне. Сохрани копию перед переустановкой или переездом на новый.
      </Text>

      {/* Above the buttons, not below them: this section is the last thing on a
          scrolling screen, so a note rendered underneath landed off the bottom
          edge (measured at y 615-591 on a 640px device) — you tapped the
          button and the confirmation appeared where you could not see it. */}
      {note && <Text style={[styles.note, note.tone === "error" && styles.noteError]}>{note.text}</Text>}

      <View style={styles.buttonRow}>
        <Pressable
          onPress={onExport}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Скачать данные в файл"
          style={({ pressed }) => [styles.button, styles.primary, (pressed || busy === "export") && styles.pressed]}
        >
          <Text style={styles.primaryText}>{busy === "export" ? "Сохраняю…" : "Скачать данные"}</Text>
        </Pressable>
        <Pressable
          onPress={onPick}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Загрузить данные из файла"
          style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Загрузить из файла</Text>
        </Pressable>
      </View>

      {pending && (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingSummary}>{summarise(pending)}</Text>
          <Text style={styles.pendingHint}>
            «Добавить» подтянет только то, чего здесь ещё нет, и не тронет уже отмеченные дни.
          </Text>
          <View style={styles.buttonRow}>
            <Pressable
              onPress={() => void run("merge")}
              disabled={busy !== null}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>Добавить к моим</Text>
            </Pressable>
            <Pressable
              onPress={onReplace}
              disabled={busy !== null}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.danger, pressed && styles.pressed]}
            >
              <Text style={styles.dangerText}>Заменить всё</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => setPending(null)} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      )}

      {busy === "import" && !pending && <ActivityIndicator color={colors.textMuted} style={{ marginTop: 12 }} />}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  subtle: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 12 },
  buttonRow: { flexDirection: "row", gap: 10 },
  button: { flex: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, alignItems: "center" },
  pressed: { opacity: 0.65 },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: colors.bg, fontSize: 13, fontWeight: "600" },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  secondaryText: { color: colors.text, fontSize: 13, fontWeight: "500" },
  danger: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent },
  dangerText: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  pendingCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
    gap: 10,
  },
  pendingSummary: { color: colors.text, fontSize: 13, fontWeight: "500" },
  pendingHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  cancel: { alignItems: "center", paddingVertical: 4 },
  cancelText: { color: colors.textMuted, fontSize: 12 },
  note: { color: colors.accentGreen, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  noteError: { color: colors.accent },
});
