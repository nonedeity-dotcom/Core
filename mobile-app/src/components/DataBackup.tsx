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
  countRecords,
  BackupError,
  parseBackupText,
  SCOPE_LABELS,
  type BackupScope,
  type ImportMode,
  type ParsedBackup,
} from "../lib/backup";
import { saveTextFile, pickTextFile } from "../lib/backupFile";
import type { ImportStats } from "../api/client";

type Busy = null | "export" | "import";
type Note = { tone: "ok" | "error"; text: string };

/**
 * Одна строка про то, что в файле.
 *
 * Раньше перечислялись привычки, отметки и сессии — то есть только Sterzhen, и копия
 * одного «Экрана» представлялась тремя нулями. Теперь называется раздел файла и сколько в
 * нём записей: это то, по чему человек и узнаёт, тот ли файл он выбрал.
 */
function summarise(p: ParsedBackup): string {
  const when = p.exportedAt ? `Копия от ${formatDateShort(p.exportedAt)}` : "Копия";
  const n = countRecords(p.data, p.scope);
  const what = p.scope === "all" ? "" : ` (${SCOPE_LABELS[p.scope]})`;
  return `${when}${what}: ${n} ${plural(n, ["запись", "записи", "записей"])}`;
}

function describeImport(stats: ImportStats, mode: ImportMode): string {
  if (mode === "replace") {
    return `Данные заменены: ${stats.habits} ${plural(stats.habits, ["привычка", "привычки", "привычек"])}, ${
      stats.habitLog
    } ${plural(stats.habitLog, ["отметка", "отметки", "отметок"])}.`;
  }
  const added =
    stats.habits + stats.habitLog + stats.sessions + stats.energy + stats.rewards + stats.balance + stats.screen;
  if (added === 0) return "Всё из этого файла уже есть — ничего не изменилось.";
  // Называется только то, чего действительно прибавилось: «0 привычек, 0 отметок,
  // 1 запись CaloriX» — это отчёт о разделах, которых в файле и не было.
  const parts: string[] = [];
  const say = (n: number, forms: [string, string, string]) => {
    if (n > 0) parts.push(`${n} ${plural(n, forms)}`);
  };
  say(stats.habits, ["привычка", "привычки", "привычек"]);
  say(stats.habitLog, ["отметка", "отметки", "отметок"]);
  say(stats.sessions, ["сессия", "сессии", "сессий"]);
  say(stats.energy, ["замер энергии", "замера энергии", "замеров энергии"]);
  say(stats.rewards, ["награда", "награды", "наград"]);
  if (stats.balance > 0) {
    parts.push(`${stats.balance} ${plural(stats.balance, ["запись", "записи", "записей"])} CaloriX`);
  }
  if (stats.screen > 0) {
    parts.push(`${stats.screen} ${plural(stats.screen, ["запись", "записи", "записей"])} Creker`);
  }
  return `Добавлено: ${parts.join(", ")}.`;
}

/**
 * Export/import for the whole local database.
 *
 * Everything lives in AsyncStorage on one device, so uninstalling the app or
 * changing phones threw away the entire history with no way to get it back.
 * This is that way: one JSON file out, the same file back in.
 */
export default function DataBackup({
  scope = "all",
  title,
  hint,
}: {
  /** Какой раздел выгружается. Загрузка принимает любой файл — он сам говорит, что в нём. */
  scope?: BackupScope;
  title?: string;
  hint?: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const onExport = async () => {
    setBusy("export");
    setNote(null);
    try {
      const name = backupFileName(new Date(), scope);
      const result = await saveTextFile(name, await buildBackupText(scope));
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
      pending.scope === "all" ? "Заменить все данные?" : `Заменить данные ${SCOPE_LABELS[pending.scope]}?`,
      pending.scope === "all"
        ? "Привычки, отметки, сессии и заметки на этом телефоне будут стёрты и заменены содержимым файла. Отменить это будет нечем."
        : `На этом телефоне будет стёрто и заменено содержимым файла только то, что относится к ${SCOPE_LABELS[pending.scope]}. Остальные разделы не тронутся. Отменить это будет нечем.`,
      () => void run("replace"),
      "Заменить",
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>{title ?? "Данные"}</Text>
      <Text style={styles.subtle}>
        {hint ??
          "Всё хранится только на этом телефоне. Сохрани копию перед переустановкой или переездом на новый."}
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
          accessibilityLabel={`Скачать данные (${SCOPE_LABELS[scope]}) в файл`}
          style={({ pressed }) => [styles.button, styles.primary, (pressed || busy === "export") && styles.pressed]}
        >
          <Text style={styles.primaryText}>{busy === "export" ? "Сохраняю…" : "Скачать данные"}</Text>
        </Pressable>
        <Pressable
          onPress={onPick}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`Загрузить данные (${SCOPE_LABELS[scope]}) из файла`}
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
              <Text style={styles.dangerText}>
                {pending.scope === "all" ? "Заменить всё" : "Заменить раздел"}
              </Text>
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
