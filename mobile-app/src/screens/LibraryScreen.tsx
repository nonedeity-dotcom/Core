import { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { confirmDestructive } from "../lib/confirm";
import { SECTIONS, type Tip } from "../content/library";
import {
  DEFAULT_TIP_PREFS,
  MAX_TIP_SHORT,
  hiddenCount,
  isBuiltIn,
  rotationFor,
  rotationNumberFor,
  tipsInSectionFor,
  withTipMovedTo,
  withTipRemoved,
  type TipPrefs,
} from "../lib/tipLibrary";
import TipCard from "../components/TipCard";

/**
 * The whole reference, grouped into the four themes the app is built on — and, behind
 * «Изменить», the place to change it.
 *
 * Editing lives here rather than on a screen of its own because this is already the list of
 * every tip: a separate editor would be the same list twice, and the thing you want to fix
 * is usually the line you are looking at.
 *
 * One section is open at a time: five dozen tips laid out flat is exactly the scrollable
 * feed this app exists to argue against.
 */
export default function LibraryScreen() {
  const qc = useQueryClient();
  const [openSection, setOpenSection] = useState<string | null>(SECTIONS[0]?.id ?? null);
  const [openTips, setOpenTips] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const { data: prefs = DEFAULT_TIP_PREFS } = useQuery<TipPrefs>({
    queryKey: ["tipPrefs"],
    queryFn: () => api.getTipPrefs(),
  });

  const save = useMutation({
    mutationFn: (next: TipPrefs) => api.setTipPrefs(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tipPrefs"] }),
  });

  const rotation = rotationFor(prefs);
  const total = rotation.length;
  const hidden = hiddenCount(prefs);

  const toggleTip = (id: string) =>
    setOpenTips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeTip = (tip: Tip) =>
    confirmDestructive(
      isBuiltIn(tip.id) ? "Скрыть подсказку?" : "Удалить подсказку?",
      isBuiltIn(tip.id)
        ? `«${tip.short}» исчезнет из справочника и из ротации. Встроенные подсказки живут в самом приложении, поэтому она прячется, а не стирается — вернуть можно внизу этого экрана.`
        : `«${tip.short}» будет удалена насовсем.`,
      () => save.mutate(withTipRemoved(prefs, tip.id)),
      isBuiltIn(tip.id) ? "Скрыть" : "Удалить",
    );

  const saveEdit = (tip: Tip, draft: Draft) => {
    const short = draft.short.trim();
    if (!short) {
      setEditingId(null);
      return;
    }
    const full = draft.full.trim();
    if (isBuiltIn(tip.id)) {
      save.mutate({
        ...prefs,
        overrides: { ...prefs.overrides, [tip.id]: { short, full, rotate: draft.rotate } },
      });
    } else {
      save.mutate({
        ...prefs,
        custom: prefs.custom.map((c) => (c.id === tip.id ? { ...c, short, full, rotate: draft.rotate } : c)),
      });
    }
    setEditingId(null);
  };

  const addTip = (sectionId: string, draft: Draft) => {
    const short = draft.short.trim();
    if (!short) {
      setAdding(null);
      return;
    }
    save.mutate({
      ...prefs,
      custom: [
        ...prefs.custom,
        {
          id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          section: sectionId,
          short,
          full: draft.full.trim(),
          rotate: draft.rotate,
        },
      ],
    });
    setAdding(null);
  };

  const restoreHidden = () =>
    confirmDestructive(
      "Вернуть скрытые подсказки?",
      `${hidden} скрытых снова появятся в справочнике. Ваши правки текста при этом сохранятся.`,
      () => save.mutate({ ...prefs, hidden: [] }),
      "Вернуть",
      false,
    );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View style={styles.headerRow}>
        <Text style={styles.intro}>
          Всё, к чему подталкивает приложение, и почему. Из них {total}{" "}
          {total === 1 ? "пронумерована и показывается" : "пронумерованы и по очереди показываются"} на
          «Отчёте» — номер слева от подсказки её и обозначает.
        </Text>
      </View>

      <Pressable
        onPress={() => {
          setEditing((v) => !v);
          setEditingId(null);
          setAdding(null);
        }}
        accessibilityRole="button"
        accessibilityLabel={editing ? "Выйти из редактирования" : "Редактировать подсказки"}
        style={({ pressed }) => [styles.editToggle, editing && styles.editToggleOn, pressed && styles.pressed]}
      >
        <Feather name={editing ? "check" : "edit-2"} size={13} color={editing ? colors.bg : colors.textMuted} />
        <Text style={[styles.editToggleText, editing && styles.editToggleTextOn]}>
          {editing ? "Готово" : "Изменить"}
        </Text>
      </Pressable>

      {SECTIONS.map((section) => {
        const open = openSection === section.id;
        const tips = tipsInSectionFor(prefs, section.id);
        return (
          <View key={section.id} style={styles.section}>
            <Pressable
              onPress={() => setOpenSection(open ? null : section.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => [styles.sectionHeader, pressed && styles.pressed]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionBlurb}>{section.blurb}</Text>
              </View>
              <Text style={styles.sectionCount}>{tips.length}</Text>
            </Pressable>

            {open && (
              <View style={styles.sectionBody}>
                {tips.map((tip) =>
                  editingId === tip.id ? (
                    <TipEditor
                      key={tip.id}
                      tip={tip}
                      onSave={(draft) => saveEdit(tip, draft)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <View key={tip.id}>
                      <TipCard
                        tip={tip}
                        number={rotationNumberFor(prefs, tip.id)}
                        expanded={openTips.has(tip.id)}
                        onToggle={() => toggleTip(tip.id)}
                      />
                      {editing && (
                        <TipTools
                          tip={tip}
                          number={rotationNumberFor(prefs, tip.id)}
                          total={total}
                          onMove={(to) => save.mutate(withTipMovedTo(prefs, tip.id, to))}
                          onEdit={() => setEditingId(tip.id)}
                          onRemove={() => removeTip(tip)}
                        />
                      )}
                    </View>
                  ),
                )}

                {editing &&
                  (adding === section.id ? (
                    <TipEditor
                      onSave={(draft) => addTip(section.id, draft)}
                      onCancel={() => setAdding(null)}
                    />
                  ) : (
                    <Pressable
                      onPress={() => setAdding(section.id)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
                    >
                      <Feather name="plus" size={16} color={colors.textMuted} />
                      <Text style={styles.addRowText}>Своя подсказка в «{section.title}»</Text>
                    </Pressable>
                  ))}
              </View>
            )}
          </View>
        );
      })}

      {editing && hidden > 0 && (
        <Pressable
          onPress={restoreHidden}
          accessibilityRole="button"
          style={({ pressed }) => [styles.restoreRow, pressed && styles.pressed]}
        >
          <Feather name="rotate-ccw" size={14} color={colors.accent} />
          <Text style={styles.restoreText}>{`Вернуть скрытые · ${hidden}`}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

interface Draft {
  short: string;
  full: string;
  rotate: boolean;
}

/**
 * The row's own controls, under the card rather than inside it.
 *
 * Inside would mean the card that is tapped to expand also carries four tap targets, and
 * "открыть текст" and "удалить" are not things to put a thumb's width apart.
 */
function TipTools({
  tip,
  number,
  total,
  onMove,
  onEdit,
  onRemove,
}: {
  tip: Tip;
  number: number | null;
  total: number;
  onMove: (to: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.tools}>
      {number != null ? (
        <View style={styles.numberBox}>
          <Pressable
            onPress={() => onMove(number - 1)}
            disabled={number <= 1}
            accessibilityRole="button"
            accessibilityLabel={`Раньше в ротации: ${tip.short}`}
            style={({ pressed }) => [styles.numBtn, number <= 1 && styles.numBtnOff, pressed && styles.pressed]}
          >
            <Feather name="chevron-up" size={14} color={colors.textMuted} />
          </Pressable>
          <Text style={styles.numberValue}>{`№ ${number} из ${total}`}</Text>
          <Pressable
            onPress={() => onMove(number + 1)}
            disabled={number >= total}
            accessibilityRole="button"
            accessibilityLabel={`Позже в ротации: ${tip.short}`}
            style={({ pressed }) => [styles.numBtn, number >= total && styles.numBtnOff, pressed && styles.pressed]}
          >
            <Feather name="chevron-down" size={14} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Text style={styles.noNumber}>без номера — только в справочнике</Text>
      )}

      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Изменить: ${tip.short}`}
        style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
      >
        <Feather name="edit-2" size={14} color={colors.textMuted} />
      </Pressable>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`${isBuiltIn(tip.id) ? "Скрыть" : "Удалить"}: ${tip.short}`}
        style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
      >
        <Feather name={isBuiltIn(tip.id) ? "eye-off" : "trash-2"} size={14} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

/** The card turned into a form: the line, the paragraph, and whether it joins the rotation. */
function TipEditor({
  tip,
  onSave,
  onCancel,
}: {
  tip?: Tip;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [short, setShort] = useState(tip?.short ?? "");
  const [full, setFull] = useState(tip?.full ?? "");
  const [rotate, setRotate] = useState(tip?.rotate ?? true);

  return (
    <View style={styles.editCard}>
      <TextInput
        value={short}
        onChangeText={(v) => setShort(v.slice(0, MAX_TIP_SHORT))}
        autoFocus
        placeholder="Одна строка — то, что видно свёрнутым…"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        accessibilityLabel="Короткая строка подсказки"
      />
      <TextInput
        value={full}
        onChangeText={setFull}
        placeholder="Текст, который раскрывается по нажатию…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputTall]}
        multiline
        accessibilityLabel="Полный текст подсказки"
      />

      <Pressable
        onPress={() => setRotate((v) => !v)}
        accessibilityRole="switch"
        accessibilityState={{ checked: rotate }}
        style={({ pressed }) => [styles.chip, rotate && styles.chipOn, pressed && styles.pressed]}
      >
        <Text style={[styles.chipText, rotate && styles.chipTextOn]}>
          {rotate ? "Показывать на «Отчёте»" : "Только в справочнике"}
        </Text>
      </Pressable>

      <View style={styles.editActions}>
        <Pressable
          onPress={() => onSave({ short, full, rotate })}
          accessibilityRole="button"
          accessibilityLabel="Сохранить подсказку"
          style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
        >
          <Feather name="check" size={16} color={colors.accentGreen} />
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Отменить"
          style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
        >
          <Feather name="x" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17, flex: 1 },
  editToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.card,
    marginTop: 12,
    marginBottom: 16,
  },
  editToggleOn: { backgroundColor: colors.accentGreen },
  editToggleText: { color: colors.textMuted, fontSize: 12 },
  editToggleTextOn: { color: colors.bg, fontWeight: "600" },
  section: { marginBottom: 10 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pressed: { opacity: 0.75 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sectionBlurb: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  sectionCount: { color: colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  sectionBody: { marginTop: 10, paddingLeft: 10 },
  tools: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: -4,
    marginBottom: 12,
    paddingLeft: 4,
  },
  numberBox: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  numBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  numBtnOff: { opacity: 0.35 },
  numberValue: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    marginHorizontal: 4,
  },
  noNumber: { color: colors.textMuted, fontSize: 11, flex: 1 },
  toolBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  addRowText: { color: colors.textMuted, fontSize: 13 },
  restoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  restoreText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  editCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 10,
  },
  input: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputTall: { minHeight: 90, textAlignVertical: "top", fontSize: 13, lineHeight: 19 },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
});
