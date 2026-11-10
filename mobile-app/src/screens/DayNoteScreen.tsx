import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { confirmDestructive, notify } from "../lib/confirm";
import { formatDayLong, todayKey, weekdayLabel } from "../lib/date";
import { DAY_NOTE_MAX, isDateKey, type DayNote } from "../lib/dayNotes";

/**
 * Один итог дня на весь экран.
 *
 * Есть итог — он открывается для чтения, правка по кнопке. Нет — сразу поле для письма: за
 * этим сюда и пришли. Несохранённое при выходе не пропадает молча: сначала спрашиваем.
 */
export default function DayNoteScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const qc = useQueryClient();

  const param = (route.params as { date?: string } | undefined)?.date;
  const date = isDateKey(param) ? param : todayKey();
  const isToday = date === todayKey();

  const { data: notes = [], isSuccess } = useQuery<DayNote[]>({
    queryKey: ["dayNotes"],
    queryFn: () => api.getDayNotes(),
  });
  const saved = notes.find((n) => n.date === date);

  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);

  // Один раз, когда итоги прочитались: есть что читать — читаем, нет — пишем.
  useEffect(() => {
    if (!isSuccess || ready) return;
    setText(saved?.text ?? "");
    setEditing(!saved);
    setReady(true);
  }, [isSuccess, ready, saved]);

  const dirty = editing && text.trim() !== (saved?.text ?? "");
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Выход с несохранённым текстом: сначала спросить, а не потерять написанное.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e) => {
        if (!dirtyRef.current) return;
        e.preventDefault();
        Alert.alert("Выйти без сохранения?", "Написанное не сохранится.", [
          { text: "Остаться", style: "cancel" },
          { text: "Выйти", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["dayNotes"] });

  const save = useMutation({
    mutationFn: () => api.saveDayNote(date, text),
    onSuccess: async (note) => {
      await refresh();
      if (note) {
        setText(note.text);
        setEditing(false);
      }
    },
    onError: (e) => notify("Не получилось сохранить", e instanceof Error ? e.message : "Попробуйте ещё раз."),
  });

  const remove = useMutation({
    mutationFn: () => api.removeDayNote(date),
    onSuccess: async () => {
      await refresh();
      setText("");
      setEditing(false);
      navigation.goBack();
    },
  });

  const confirmRemove = () =>
    confirmDestructive("Удалить итог?", `Итог за «${formatDayLong(date)}» исчезнет.`, () => remove.mutate());

  const cancelEditing = () => {
    setText(saved?.text ?? "");
    setEditing(!saved);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.date}>
          {formatDayLong(date)} · {weekdayLabel(date)}
          {isToday ? " · сегодня" : ""}
        </Text>

        {!ready ? null : editing ? (
          <>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoFocus={!saved}
              maxLength={DAY_NOTE_MAX}
              placeholder="Как прошёл день? Что получилось, что нет, что запомнилось…"
              placeholderTextColor={colors.textMuted}
              textAlignVertical="top"
              style={styles.input}
            />
            <Text style={styles.counter}>
              {text.length} / {DAY_NOTE_MAX}
            </Text>
          </>
        ) : (
          <Text selectable style={styles.body}>
            {saved?.text}
          </Text>
        )}
      </ScrollView>

      {ready && (
        <View style={styles.bar}>
          {editing ? (
            <>
              {saved && (
                <Pressable
                  onPress={cancelEditing}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.btn, styles.btnQuiet, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.btnQuietText}>Отмена</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => save.mutate()}
                disabled={text.trim() === "" || !dirty || save.isPending}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnMain,
                  (text.trim() === "" || !dirty) && { opacity: 0.4 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.btnMainText}>{save.isPending ? "Сохраняю…" : "Сохранить"}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={confirmRemove}
                accessibilityRole="button"
                accessibilityLabel="Удалить итог"
                style={({ pressed }) => [styles.btn, styles.btnQuiet, pressed && { opacity: 0.7 }]}
              >
                <Feather name="trash-2" size={16} color={colors.accent} />
              </Pressable>
              <Pressable
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.btn, styles.btnMain, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.btnMainText}>Изменить</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  date: { color: colors.textMuted, fontSize: 12 },
  body: { color: colors.text, fontSize: 16, lineHeight: 25, marginTop: 14 },
  input: {
    marginTop: 14,
    minHeight: 260,
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  counter: { color: colors.textMuted, fontSize: 11, textAlign: "right", marginTop: 6 },

  bar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  btn: { alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
  btnMain: {
    flex: 1,
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(143,184,154,0.12)",
  },
  btnMainText: { color: colors.accentGreen, fontSize: 14, fontWeight: "600" },
  btnQuiet: { paddingHorizontal: 18, borderColor: colors.cardBorder, backgroundColor: colors.card },
  btnQuietText: { color: colors.text, fontSize: 14, fontWeight: "500" },
});
