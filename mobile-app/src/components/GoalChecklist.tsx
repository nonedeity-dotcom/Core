import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { itemCount, itemDone, itemTarget, type GoalItem } from "../lib/goals";

/**
 * Пункты цели: галочка у обычного шага, счётчик у шага с числом.
 *
 * Ни то, ни другое приложение не считает само — оно не знает, выучены ли билеты, и не должно
 * делать вид. Отметка стоит вручную и помнит за человека, а не оценивает его.
 *
 * Счётчик нужен затем, что «сходить в зал двенадцать раз» галочкой не меряется: до
 * тридцатого числа такой шаг выглядит невыполненным, хотя сделан почти весь. Убавляется он
 * отдельной кнопкой и никогда — касанием по строке: один промах пальцем не должен стирать
 * месяц работы.
 */
export default function GoalChecklist({
  items,
  onToggle,
  onStep,
  onRename,
  onRemove,
  empty,
}: {
  items: GoalItem[];
  onToggle: (id: string) => void;
  /** Только у шагов со счётчиком. Без него счётчик умеет лишь прибавлять. */
  onStep?: (id: string, delta: number) => void;
  /** Без него имена не правятся — так итог не превращается в переписывание задним числом. */
  onRename?: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
  empty?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Правка закрывается сама, если шаг исчез из списка, — иначе поле осталось бы висеть
  // поверх пустоты.
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    known.current = new Set(items.map((i) => i.id));
    if (editingId && !known.current.has(editingId)) setEditingId(null);
  }, [items, editingId]);

  const commitName = () => {
    if (editingId && onRename) onRename(editingId, draft);
    setEditingId(null);
  };

  if (items.length === 0) {
    return empty ? <Text style={styles.empty}>{empty}</Text> : null;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => {
        const target = itemTarget(item);
        const count = itemCount(item);
        const done = itemDone(item);
        const counted = target > 1;
        return (
          <View key={item.id} style={styles.row}>
            {counted ? (
              <Pressable
                onPress={() => onToggle(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.text}: ${count} из ${target}`}
                hitSlop={6}
                style={({ pressed }) => [styles.counter, done && styles.counterDone, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.counterText, done && styles.counterTextDone]}>
                  {count}/{target}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => onToggle(item.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={item.text}
                hitSlop={8}
                style={({ pressed }) => [styles.box, done && styles.boxDone, pressed && { opacity: 0.6 }]}
              >
                {done && <Feather name="check" size={13} color={colors.bg} />}
              </Pressable>
            )}

            {editingId === item.id ? (
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onBlur={commitName}
                onSubmitEditing={commitName}
                autoFocus
                returnKeyType="done"
                style={styles.nameInput}
                accessibilityLabel={`Имя шага: ${item.text}`}
              />
            ) : (
              <Pressable
                onPress={() => {
                  if (!onRename) return;
                  setDraft(item.text);
                  setEditingId(item.id);
                }}
                disabled={!onRename}
                accessibilityRole={onRename ? "button" : "text"}
                accessibilityLabel={onRename ? `Переименовать: ${item.text}` : item.text}
                style={{ flex: 1 }}
              >
                <Text style={[styles.text, done && styles.textDone]}>{item.text}</Text>
              </Pressable>
            )}

            {/* Убавление только у счётчика и только когда есть что убавлять. */}
            {counted && onStep && count > 0 && editingId !== item.id && (
              <Pressable
                onPress={() => onStep(item.id, -1)}
                accessibilityRole="button"
                accessibilityLabel={`Убавить: ${item.text}`}
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Feather name="minus" size={15} color={colors.textMuted} />
              </Pressable>
            )}
            {onRemove && editingId !== item.id && (
              <Pressable
                onPress={() => onRemove(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Убрать: ${item.text}`}
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Feather name="x" size={15} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  boxDone: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  counter: {
    minWidth: 42,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: "center",
  },
  counterDone: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  counterText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  counterTextDone: { color: colors.bg },
  text: { color: colors.text, fontSize: 14, lineHeight: 19 },
  textDone: { color: colors.textMuted, textDecorationLine: "line-through" },
  nameInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  empty: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
