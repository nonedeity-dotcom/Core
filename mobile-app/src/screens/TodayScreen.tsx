import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors } from "../theme/colors";
import { confirmDestructive } from "../lib/confirm";
import { useTodayKey } from "../lib/useTodayKey";
import { plural } from "../lib/plural";
import { useFoldSet } from "../lib/useFold";
import { weekStart, weekDatesThrough } from "../lib/week";
import { habitStanding, standingRank, type HabitStanding } from "../lib/habitStanding";
import { useStreak, frozenDaysFor } from "../lib/useStreak";
import { DEFAULT_DAY_RULE, requiredForDay, type DayRule } from "../lib/dayRule";
import {
  MAX_TARGET_COUNT,
  habitGroup,
  habitTarget,
  habitsThatDecideTheDay,
  logCount,
  perDayTarget,
  weeklyProgress,
} from "../lib/habits";
import { syncScreenTimeHabit } from "../integrations/screenTime";
import type { Habit, HabitLog, HabitTarget, ItemGroup } from "../types";

/**
 * The three piles, in the order they are shown. Only the first decides the day; the reason
 * for the split is that a list of ten things you eventually want is not a list of ten things
 * you are doing, and judging today against the whole list makes the list unusable.
 */
const GROUPS: { id: ItemGroup; title: string; blurb: string }[] = [
  { id: "now", title: "Ввожу сейчас", blurb: "по ним засчитывается день — держи этот список коротким" },
  { id: "extra", title: "Дополнительно", blurb: "можно отмечать, на зачёт дня не влияет" },
  { id: "later", title: "Потом", blurb: "план на будущее, отмечать пока нечего" },
];

export default function TodayScreen() {
  const qc = useQueryClient();
  const today = useTodayKey();
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Whether the per-row controls and the add row are on show. Off by default. */
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editMinimal, setEditMinimal] = useState("");
  const [editGroup, setEditGroup] = useState<ItemGroup>("now");
  const [editTarget, setEditTarget] = useState<HabitTarget>({ kind: "daily", count: 1 });
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  // One per group, and closed again the moment you leave the tab.
  const folds = useFoldSet();

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });

  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", today],
    queryFn: () => api.getHabitLog(today, today) as Promise<HabitLog[]>,
  });

  // A weekly habit's progress is a count of days, so the row needs this week, not just today.
  const monday = weekStart(today);
  const { data: weekLogs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "week", monday, today],
    queryFn: () => api.getHabitLog(monday, today) as Promise<HabitLog[]>,
  });
  const weekDates = weekDatesThrough(today);

  // The four months of marks each habit's own run is walked over, plus the chances it has
  // spent. Shared with the report through React Query's cache rather than fetched twice —
  // and this is also the one hook that grants a freeze, which is idempotent.
  const { logs: streakLogs, freezes, habitFreezes, skipRule } = useStreak(today);

  // How much of the pile closes a day is a setting; the header is the one place on this
  // screen that has to say what today is actually asking for.
  const { data: dayRule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });

  const invalidateHabits = () => qc.invalidateQueries({ queryKey: ["habits"] });

  useEffect(() => {
    if (habits.length === 0) return;
    syncScreenTimeHabit(habits, today).then((synced) => {
      if (synced) qc.invalidateQueries({ queryKey: ["habitLog"] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits.length, today]);

  /**
   * One tap: one step up, stopping at the target. It never steps back — that was the whole
   * complaint about the old checkbox, where the same tap that marked a habit done also
   * un-did it. Correcting a mis-tap lives in edit mode instead.
   */
  const bump = useMutation({
    mutationFn: ({ habit, minimal }: { habit: Habit; minimal?: boolean }) =>
      api.bumpHabit(habit.id, today, perDayTarget(habit), minimal ?? false),
    // Optimistic, so the number moves under the finger instead of after a round trip.
    onMutate: async ({ habit, minimal }) => {
      await qc.cancelQueries({ queryKey: ["habitLog", today] });
      const prev = qc.getQueryData<HabitLog[]>(["habitLog", today]) || [];
      const target = perDayTarget(habit);
      const current = logCount(prev.find((l) => l.habitId === habit.id));
      const next = Math.min(target, current + 1);
      const done = next >= target;
      const rows = prev.some((l) => l.habitId === habit.id)
        ? prev.map((l) => (l.habitId === habit.id ? { ...l, count: next, done, minimal: done && !!minimal } : l))
        : [...prev, { id: "temp", habitId: habit.id, date: today, count: next, done, minimal: done && !!minimal }];
      qc.setQueryData(["habitLog", today], rows);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["habitLog", today], ctx.prev);
    },
    // The whole habitLog prefix: the report keeps its own week and streak queries, and
    // ticking here used to leave them showing yesterday's numbers.
    onSettled: () => qc.invalidateQueries({ queryKey: ["habitLog"] }),
  });

  const resetDay = useMutation({
    mutationFn: (habitId: string) => api.resetHabitDay(habitId, today),
    onSettled: () => qc.invalidateQueries({ queryKey: ["habitLog"] }),
  });

  const addHabit = useMutation({
    mutationFn: (label: string) => api.addHabit(label),
    onSuccess: () => {
      setNewLabel("");
      setAdding(false);
      invalidateHabits();
    },
  });

  const updateHabit = useMutation({
    mutationFn: (data: { id: string; label: string; minimal: string | null; group: ItemGroup; target: HabitTarget }) =>
      api.updateHabit(data.id, { label: data.label, minimal: data.minimal, group: data.group, target: data.target }),
    onSuccess: () => {
      setEditingId(null);
      invalidateHabits();
      // The day's verdict depends on which pile a habit is in and what it is owed.
      qc.invalidateQueries({ queryKey: ["habitLog"] });
    },
  });

  const archiveHabit = useMutation({
    mutationFn: (id: string) => api.archiveHabit(id),
    onSuccess: () => {
      invalidateHabits();
      qc.invalidateQueries({ queryKey: ["archivedHabits"] });
      qc.invalidateQueries({ queryKey: ["habitLog"] });
    },
  });

  // Still behind a confirmation, but a much milder one than before: this used to erase the
  // habit and every mark it ever had, with no undo. Now it moves house, and the only way to
  // lose the history is a second, deliberate tap in the archive.
  const confirmArchive = (h: Habit) =>
    confirmDestructive(
      "Убрать в архив?",
      `«${h.label}» переедет в архив в настройках. Отметки сохранятся.`,
      () => archiveHabit.mutate(h.id),
      "Убрать",
    );

  const startEdit = (h: Habit) => {
    setEditingId(h.id);
    setEditDraft(h.label);
    setEditMinimal(h.minimal ?? "");
    setEditGroup(habitGroup(h));
    setEditTarget(habitTarget(h));
  };

  const saveEdit = () => {
    if (editingId && editDraft.trim()) {
      updateHabit.mutate({
        id: editingId,
        label: editDraft.trim(),
        // Empty means "no minimal version", not an empty string to render.
        minimal: editMinimal.trim() || null,
        group: editGroup,
        target: editTarget,
      });
    } else setEditingId(null);
  };

  const submitNew = () => {
    if (newLabel.trim()) addHabit.mutate(newLabel.trim());
    else setAdding(false);
  };

  /**
   * Where each habit stands — which decides both how its row looks and where it sits, so it
   * is answered once, here, rather than inside each row.
   *
   * Same rule the report uses, from the same place: a habit that will lose its run tonight
   * rises, a weekly one you could skip today and still close the week sinks below what is
   * actually owed today, and a finished one goes to the bottom.
   */
  // Today's rows come from the day query, which the optimistic tick writes into — the
  // four-month one would still say "not done" for a second after a tap and bounce the row
  // between piles.
  const allLogs = [...streakLogs.filter((l) => l.date !== today), ...logs];

  const standingOf = (h: Habit): HabitStanding =>
    habitStanding(h, allLogs, {
      today,
      excused: frozenDaysFor(h.id, freezes, habitFreezes),
      own: habitFreezes[h.id] ?? [],
      rule: skipRule,
      weekDates,
    });

  const nowHabits = habits.filter((h) => habitGroup(h) === "now");
  const deciding = habitsThatDecideTheDay(habits);
  const closed = deciding.filter((h) => logCount(logs.find((l) => l.habitId === h.id)) >= perDayTarget(h)).length;
  const required = requiredForDay(dayRule, deciding.length);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>
      <View style={styles.headerRow}>
        <Text style={styles.subtle}>
          {/* Only daily habits decide a day, so the count is over those. With nothing but
              weekly ones in the pile "ни одной привычки в работе" was flatly wrong — there
              are habits there, they just are not owed today. */}
          {deciding.length > 0
            ? required < deciding.length
              // With a partial rule "закрыто 2 из 5" is only half the sentence — it does not
              // say whether the day is already held.
              ? `Сегодня закрыто ${closed} из ${deciding.length} · нужно ${required}`
              : `Сегодня закрыто ${closed} из ${deciding.length}`
            : nowHabits.length > 0
              ? "В работе только недельные — день по ним не засчитывается"
              : "Ни одной привычки в работе"}
        </Text>
        <Pressable
          onPress={() => {
            setEditing((v) => !v);
            setEditingId(null);
            setAdding(false);
          }}
          accessibilityRole="button"
          accessibilityLabel={editing ? "Выйти из редактирования" : "Редактировать список"}
          style={({ pressed }) => [styles.editToggle, editing && styles.editToggleOn, pressed && styles.pressed]}
        >
          <Feather name={editing ? "check" : "edit-2"} size={13} color={editing ? colors.bg : colors.textMuted} />
          <Text style={[styles.editToggleText, editing && styles.editToggleTextOn]}>
            {editing ? "Готово" : "Изменить"}
          </Text>
        </Pressable>
      </View>

      {GROUPS.map((group) => {
        const inGroup = habits.filter((h) => habitGroup(h) === group.id);
        // An empty pile is only worth a heading while you are sorting things into it.
        if (inGroup.length === 0 && !editing) return null;

        // Sorted by how much today wants each of them: what breaks tonight first, then what
        // is owed today, then the weekly ones with room to spare. The split is by group
        // rather than across the whole screen, so «Ввожу сейчас» — the pile that actually
        // decides the day — stays visibly separate from the two that do not.
        const standings = new Map(inGroup.map((h) => [h.id, standingOf(h)] as const));
        const rank = (h: Habit) => standingRank(standings.get(h.id)!.bucket);
        const open = inGroup.filter((h) => standings.get(h.id)!.bucket !== "done").sort((a, b) => rank(a) - rank(b));
        const done = inGroup.filter((h) => standings.get(h.id)!.bucket === "done");
        const doneOpen = folds.isOpen(group.id);

        const row = (h: Habit) =>
          editingId === h.id ? (
            <HabitEditor
              key={h.id}
              label={editDraft}
              onLabel={setEditDraft}
              minimal={editMinimal}
              onMinimal={setEditMinimal}
              group={editGroup}
              onGroup={setEditGroup}
              target={editTarget}
              onTarget={setEditTarget}
              onSave={saveEdit}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <HabitRow
              key={h.id}
              habit={h}
              group={group.id}
              editing={editing}
              standing={standings.get(h.id)!}
              count={logCount(logs.find((l) => l.habitId === h.id))}
              minimalDone={!!logs.find((l) => l.habitId === h.id)?.minimal}
              week={weeklyProgress(h, weekLogs, weekDates)}
              onBump={(minimal) => bump.mutate({ habit: h, minimal })}
              onEdit={() => startEdit(h)}
              onArchive={() => confirmArchive(h)}
              onReset={() => resetDay.mutate(h.id)}
            />
          );

        return (
          <View key={group.id} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <Text style={styles.groupBlurb}>{group.blurb}</Text>
            {inGroup.length === 0 && <Text style={styles.groupEmpty}>пусто</Text>}

            {done.length > 0 && open.length > 0 && (
              // Only worth a caption once something has moved out of it, and only while
              // something is left: with the pile empty, «Выполнено · N» right below says it.
              <Text style={styles.subHeading}>{`Осталось · ${open.length}`}</Text>
            )}
            {open.map(row)}

            {done.length > 0 && (
              <>
                <Pressable
                  onPress={() => folds.toggle(group.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: doneOpen }}
                  accessibilityLabel={`Выполнено: ${done.length}`}
                  style={({ pressed }) => [styles.doneToggle, pressed && styles.dimmed]}
                >
                  <Feather
                    name={doneOpen ? "chevron-down" : "chevron-right"}
                    size={13}
                    color={colors.accentGreen}
                  />
                  <Text style={styles.doneToggleText}>{`Выполнено · ${done.length}`}</Text>
                </Pressable>
                {doneOpen && done.map(row)}
              </>
            )}
          </View>
        );
      })}

      {/* Adding is an edit, so it lives with the other edits rather than sitting under the
          list every day of the year. */}
      {editing &&
        (adding ? (
          <View style={[styles.card, styles.cardEditing]}>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              autoFocus
              placeholder="Новая привычка…"
              placeholderTextColor={colors.textMuted}
              style={styles.editInput}
              onSubmitEditing={submitNew}
            />
            <Pressable onPress={submitNew} style={styles.iconBtn} accessibilityLabel="Сохранить привычку">
              <Feather name="check" size={16} color={colors.accentGreen} />
            </Pressable>
            <Pressable onPress={() => setAdding(false)} style={styles.iconBtn} accessibilityLabel="Отменить">
              <Feather name="x" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && styles.dimmed]}
          >
            <Feather name="plus" size={16} color={colors.textMuted} />
            <Text style={styles.addRowText}>Добавить привычку</Text>
          </Pressable>
        ))}
    </ScrollView>
  );
}

/** One habit as it looks on an ordinary day. */
function HabitRow({
  habit,
  group,
  editing,
  standing,
  count,
  minimalDone,
  week,
  onBump,
  onEdit,
  onArchive,
  onReset,
}: {
  habit: Habit;
  group: ItemGroup;
  editing: boolean;
  /**
   * Where this habit stands — finished, owed today, not owed until later in the week, or
   * about to lose its run tonight. Decided by the list, which needs the same answer to know
   * where to put the row, and carrying the line printed under the name.
   */
  standing: HabitStanding;
  count: number;
  /** The day was closed with the small version — shown as a ring rather than a filled dot. */
  minimalDone: boolean;
  week: { count: number; target: number };
  onBump: (minimal?: boolean) => void;
  onEdit: () => void;
  onArchive: () => void;
  onReset: () => void;
}) {
  const target = habitTarget(habit);
  const perDay = perDayTarget(habit);
  const doneToday = count >= perDay;
  const weekly = target.kind === "weekly";
  const closed = standing.bucket === "done";
  const urgent = standing.bucket === "urgent";
  // Not owed today — a weekly habit with room left in the week. Slightly back, the way the
  // «Потом» pile is: it is on the list, it is just not what today is asking for.
  const parked = standing.bucket === "later";
  // `closed` — what the checkbox answers — comes from the list. For a daily habit it is
  // today; for a weekly one it is the *week*: "спорт 1 раз в неделю" done on Monday is not
  // undone by Tuesday arriving, and the box used to go back to empty the next morning as if
  // the thing were still owed.
  // "Потом" is a plan: there is nothing to tick, and offering a checkbox would invite
  // ticking things you have not started.
  const tickable = group !== "later";

  return (
    <View style={styles.habitBlock}>
      <View
        style={[
          styles.card,
          styles.cardInBlock,
          closed && styles.cardChecked,
          urgent && styles.cardUrgent,
          parked && styles.cardParked,
          !tickable && styles.cardLater,
        ]}
      >
        <Pressable
          // Still tappable on a met week if today has no mark on it: a fourth run in a
          // week of three is a real thing that happened and should be recordable. What
          // stops a tap is today already being marked, which is the case where it would
          // do nothing.
          onPress={() => tickable && !doneToday && onBump()}
          disabled={!tickable || doneToday}
          accessibilityRole={perDay > 1 ? "button" : "checkbox"}
          accessibilityState={{ checked: closed, disabled: !tickable || doneToday }}
          accessibilityLabel={
            weekly
              ? `${habit.label}: за неделю ${week.count} из ${week.target}`
              : perDay > 1
                ? `${habit.label}: ${count} из ${perDay}`
                : habit.label
          }
          style={styles.cardMain}
        >
          {perDay > 1 ? (
            <View style={[styles.counter, doneToday && styles.counterDone]}>
              <Text style={[styles.counterText, doneToday && styles.counterTextDone]}>{count}</Text>
            </View>
          ) : (
            <View style={[styles.checkbox, closed && styles.checkboxChecked, minimalDone && styles.checkboxMinimal]} />
          )}
          <View style={{ flex: 1 }}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { flexShrink: 1 }, !tickable && styles.labelLater]}>{habit.label}</Text>
              {habit.auto === "screentime" && (
                <View style={styles.autoTag}>
                  <Feather name="smartphone" size={9} color={colors.textMuted} />
                  <Text style={styles.autoTagText}>Creker</Text>
                </View>
              )}
            </View>
            {!!habit.hint && <Text style={styles.hint}>{habit.hint}</Text>}
            {/* What is owed, and how much of it is behind you. */}
            {tickable && perDay > 1 && (
              <Text style={styles.progress}>
                {doneToday ? `Готово: ${perDay} из ${perDay}` : `Сделано ${count} из ${perDay}`}
              </Text>
            )}
            {/* What today wants from this habit, in the words the report uses too: how much
                of the week is behind it, how much room is left before it has to happen, or
                that tonight is the last chance to keep its run. */}
            {/* A finished daily habit says nothing: the green box says it, and the row is
                already inside «Выполнено». A finished weekly one still reports its count. */}
            {tickable && standing.note && !(standing.bucket === "done" && !weekly) && (
              <View style={styles.noteRow}>
                {urgent && <Feather name="alert-triangle" size={10} color={colors.accent} />}
                <Text style={[styles.progress, urgent && styles.progressUrgent]}>
                  {`${standing.note}${weekly && doneToday ? " · сегодня отмечено" : ""}`}
                </Text>
              </View>
            )}
            {!tickable && <Text style={styles.progress}>{describeTarget(target)}</Text>}
          </View>
        </Pressable>

        {editing && (
          <>
            {count > 0 && (
              <Pressable onPress={onReset} style={styles.iconBtn} accessibilityLabel={`Сбросить за сегодня: ${habit.label}`}>
                <Feather name="rotate-ccw" size={14} color={colors.textMuted} />
              </Pressable>
            )}
            <Pressable onPress={onEdit} style={styles.iconBtn} accessibilityLabel={`Изменить: ${habit.label}`}>
              <Feather name="edit-2" size={14} color={colors.textMuted} />
            </Pressable>
            <Pressable onPress={onArchive} style={styles.iconBtn} accessibilityLabel={`Убрать в архив: ${habit.label}`}>
              <Feather name="archive" size={14} color={colors.textMuted} />
            </Pressable>
          </>
        )}
      </View>

      {/* Only where a minimal version was declared, and only while the full one is still
          open. Ticking it closes the day the small way — step 4 of the protocol. */}
      {tickable && !!habit.minimal && !closed && (
        <Pressable
          onPress={() => onBump(true)}
          accessibilityRole="button"
          accessibilityLabel={`Отметить по минимуму: ${habit.minimal}`}
          style={({ pressed }) => [styles.minimalPill, pressed && styles.dimmed]}
        >
          <Feather name="corner-down-right" size={11} color={colors.textMuted} />
          <Text style={styles.minimalText}>{`Минимум: ${habit.minimal}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The row turned into a form: name, the small version, which pile, and how often. */
function HabitEditor({
  label,
  onLabel,
  minimal,
  onMinimal,
  group,
  onGroup,
  target,
  onTarget,
  onSave,
  onCancel,
}: {
  label: string;
  onLabel: (v: string) => void;
  minimal: string;
  onMinimal: (v: string) => void;
  group: ItemGroup;
  onGroup: (v: ItemGroup) => void;
  target: HabitTarget;
  onTarget: (v: HabitTarget) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const bumpCount = (delta: number) =>
    onTarget({ ...target, count: Math.min(MAX_TARGET_COUNT, Math.max(1, target.count + delta)) });

  return (
    <View style={styles.editCard}>
      <View style={styles.editRow}>
        <TextInput
          value={label}
          onChangeText={onLabel}
          autoFocus
          style={styles.editInput}
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={onSave}
        />
        <Pressable onPress={onSave} style={styles.iconBtn} accessibilityLabel="Сохранить привычку">
          <Feather name="check" size={16} color={colors.accentGreen} />
        </Pressable>
        <Pressable onPress={onCancel} style={styles.iconBtn} accessibilityLabel="Отменить">
          <Feather name="x" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Declared ahead of time, because on the day you need a smaller version you will not
          be in the mood to invent one. */}
      <TextInput
        value={minimal}
        onChangeText={onMinimal}
        placeholder="Минимальный вариант на плохой день…"
        placeholderTextColor={colors.textMuted}
        style={[styles.editInput, styles.editMinimalInput]}
        accessibilityLabel="Минимальный вариант"
        onSubmitEditing={onSave}
      />

      <Text style={styles.editLabel}>Куда</Text>
      <View style={styles.chipRow}>
        {GROUPS.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => onGroup(g.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: group === g.id }}
            style={({ pressed }) => [styles.chip, group === g.id && styles.chipOn, pressed && styles.dimmed]}
          >
            <Text style={[styles.chipText, group === g.id && styles.chipTextOn]}>{g.title}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.editLabel}>Сколько раз</Text>
      <View style={styles.chipRow}>
        {([
          ["daily", "в день"],
          ["weekly", "в неделю"],
        ] as const).map(([kind, title]) => (
          <Pressable
            key={kind}
            onPress={() => onTarget({ ...target, kind })}
            accessibilityRole="radio"
            accessibilityState={{ selected: target.kind === kind }}
            style={({ pressed }) => [styles.chip, target.kind === kind && styles.chipOn, pressed && styles.dimmed]}
          >
            <Text style={[styles.chipText, target.kind === kind && styles.chipTextOn]}>{title}</Text>
          </Pressable>
        ))}
        <View style={styles.stepper}>
          <Pressable
            onPress={() => bumpCount(-1)}
            accessibilityRole="button"
            accessibilityLabel="Меньше повторов"
            style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <Text style={styles.stepValue}>{target.count}</Text>
          <Pressable
            onPress={() => bumpCount(1)}
            accessibilityRole="button"
            accessibilityLabel="Больше повторов"
            style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.editNote}>
        {target.kind === "daily"
          ? `День закрыт, когда отмечено ${target.count} ${plural(target.count, ["раз", "раза", "раз"])}.`
          : `${target.count} ${plural(target.count, ["день", "дня", "дней"])} в неделю. Недельные привычки не рушат зачёт дня.`}
      </Text>
    </View>
  );
}

function describeTarget(target: HabitTarget): string {
  return target.kind === "daily"
    ? `${target.count} ${plural(target.count, ["раз", "раза", "раз"])} в день`
    : `${target.count} ${plural(target.count, ["раз", "раза", "раз"])} в неделю`;
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  editToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  editToggleOn: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  editToggleText: { color: colors.textMuted, fontSize: 12 },
  editToggleTextOn: { color: colors.bg, fontWeight: "600" },
  pressed: { opacity: 0.75 },

  subtle: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  group: { marginTop: 22 },
  groupTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  groupBlurb: { color: colors.textMuted, fontSize: 11, marginTop: 2, marginBottom: 10 },
  subHeading: { color: colors.textMuted, fontSize: 11, marginBottom: 6 },
  doneToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  doneToggleText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  groupEmpty: { color: colors.textMuted, fontSize: 12, fontStyle: "italic", marginBottom: 10 },

  habitBlock: { marginBottom: 10 },
  editCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  editRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  editMinimalInput: { fontSize: 12, color: colors.textMuted },
  editLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  editNote: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
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
  stepper: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: colors.text, fontSize: 16, lineHeight: 18 },
  stepValue: { color: colors.text, fontSize: 14, fontWeight: "600", minWidth: 18, textAlign: "center" },

  minimalPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 6,
    marginLeft: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  minimalText: { color: colors.textMuted, fontSize: 11, flexShrink: 1 },
  dimmed: { opacity: 0.7 },
  card: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardMain: { flexDirection: "row", gap: 12, alignItems: "flex-start", flex: 1 },
  cardInBlock: { marginBottom: 0 },
  cardChecked: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreenDark },
  // Warm accent as an edge, the same mark the report puts on a habit that loses its run
  // tonight — not a filled card, which on a checklist would shout over the ticking.
  cardUrgent: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  cardParked: { opacity: 0.82 },
  cardLater: { opacity: 0.6 },
  cardEditing: { borderColor: colors.accent },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 2,
    borderWidth: 1.5,
    borderColor: "#4a5058",
  },
  checkboxChecked: { backgroundColor: colors.accentGreen, borderWidth: 0 },
  checkboxMinimal: { borderColor: colors.accentGreen, borderWidth: 2, backgroundColor: "transparent" },
  counter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 1,
    borderWidth: 1.5,
    borderColor: "#4a5058",
    alignItems: "center",
    justifyContent: "center",
  },
  counterDone: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  counterText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  counterTextDone: { color: colors.bg },
  labelRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  label: { color: colors.text, fontSize: 15, fontWeight: "500" },
  labelLater: { color: colors.textMuted },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  progressUrgent: { color: colors.accent, fontWeight: "600" },
  progress: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  autoTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.bg,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  autoTagText: { color: colors.textMuted, fontSize: 9, fontWeight: "600" },
  iconBtn: { padding: 6 },
  editInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 2 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderStyle: "dashed",
  },
  addRowText: { color: colors.textMuted, fontSize: 14 },
});
