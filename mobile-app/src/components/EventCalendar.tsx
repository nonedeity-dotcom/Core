import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, withAlpha } from "../theme/colors";
import { confirmDestructive } from "../lib/confirm";
import { useTodayKey } from "../lib/useTodayKey";
import {
  LEADS,
  MAX_TITLE,
  REPEATS,
  WEEKDAYS_SHORT,
  addDays,
  availableLeads,
  dateKey,
  eventsOnDay,
  formatDay,
  keyOf,
  monthGrid,
  monthName,
  monthTitle,
  parseKey,
  relativeLabel,
  repeatLabel,
  shiftMonth,
  shiftYear,
  upcoming,
  type DateEvent,
  type Lead,
  type Repeat,
} from "../lib/dateEvents";
import { hasReminderPermission, requestReminderPermission, syncDateReminders } from "../lib/dateReminders";

/**
 * Календарь дат на Главной: компактный месяц, под ним — что скоро.
 *
 * Не календарь привычек (тот в Sterzhen и считает выполненные дни), а календарь событий:
 * дни рождения, встречи, всё, о чём нужно вспомнить. Поэтому и точки на днях тёплые —
 * в этом приложении тёплый цвет значит «сюда внимание», а зелёный занят под «сделано».
 *
 * Тап по дню выбирает его и показывает, что на нём стоит. Повторный тап снимает выбор, и
 * снизу снова «Ближайшие» — то, ради чего на Главную и смотрят.
 */

interface Draft {
  /** null — новое событие. */
  id: string | null;
  title: string;
  date: string;
  time: string | null;
  repeat: Repeat;
  leads: Lead[];
}

export default function EventCalendar() {
  const qc = useQueryClient();
  const today = useTodayKey();
  // Ключ дня от useTodayKey — «ГГГГ-ММ-ДД»; если он вдруг иной, лучше взять часы телефона,
  // чем уронить Главную.
  const now = parseKey(today) ?? parseKey(dateKey(new Date()))!;

  const [view, setView] = useState({ y: now.y, m: now.m });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // «Ближайшие» по умолчанию свёрнуты: календарь и так занимает много места на Главной.
  const [soonOpen, setSoonOpen] = useState(false);

  const { data } = useQuery<DateEvent[]>({ queryKey: ["dateEvents"], queryFn: () => api.getDateEvents() });
  const events = useMemo(() => data ?? [], [data]);

  /*
   * Напоминания пересобираются здесь, а не в местах, где событие правится: так любое
   * изменение списка — добавили, поправили, удалили, восстановили из копии — доходит до
   * уведомлений одним и тем же путём. И так же при открытии Главной и смене суток: план
   * строится от «сейчас», и дальние повторения подтягиваются сами.
   *
   * Ждём `data`, а не `events`: пока список не загрузился, пустой массив означал бы
   * «событий нет» и снёс бы все уже поставленные напоминания.
   */
  useEffect(() => {
    if (data) void syncDateReminders(data);
  }, [data, today]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dateEvents"] });
  const save = useMutation({
    mutationFn: (ev: Omit<DateEvent, "id"> & { id?: string }) => api.saveDateEvent(ev),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeDateEvent(id),
    onSuccess: invalidate,
  });

  const grid = useMemo(() => monthGrid(view.y, view.m), [view]);
  const byDay = useMemo(() => {
    const map = new Map<string, DateEvent[]>();
    for (const cell of grid) {
      const list = eventsOnDay(events, cell.key);
      if (list.length > 0) map.set(cell.key, list);
    }
    return map;
  }, [grid, events]);
  const dayEvents = useMemo(() => (selected ? eventsOnDay(events, selected) : []), [events, selected]);
  const soon = useMemo(() => upcoming(events, today, 3), [events, today]);

  const isCurrentMonth = view.y === now.y && view.m === now.m;

  const moveMonth = (delta: number) =>
    setView((v) => {
      const p = parseKey(shiftMonth(keyOf(v.y, v.m, 1), delta))!;
      return { y: p.y, m: p.m };
    });

  const pickDay = (key: string, inMonth: boolean) => {
    setSelected((s) => (s === key ? null : key));
    // День соседнего месяца, на который нажали, — повод показать тот месяц.
    if (!inMonth) {
      const p = parseKey(key)!;
      setView({ y: p.y, m: p.m });
    }
  };

  const openNew = () =>
    setDraft({ id: null, title: "", date: selected ?? today, time: null, repeat: "none", leads: ["at"] });

  const openEdit = (ev: DateEvent) =>
    setDraft({ id: ev.id, title: ev.title, date: ev.date, time: ev.time, repeat: ev.repeat, leads: ev.leads });

  const submit = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    if (title === "") return;
    const ev = {
      ...(draft.id ? { id: draft.id } : {}),
      title,
      date: draft.date,
      time: draft.time,
      repeat: draft.repeat,
      leads: draft.leads,
    };
    setDraft(null);

    /*
     * Разрешение спрашиваем до записи, а не после: запись запускает пересборку напоминаний,
     * и если бы она шла, пока открыто системное окно, то не нашла бы разрешения и ничего
     * не поставила — а после «Разрешить» пересобирать уже было бы некому.
     */
    if (ev.leads.length > 0 && !(await hasReminderPermission())) {
      const granted = await requestReminderPermission();
      if (!granted) {
        Alert.alert(
          "Уведомления выключены",
          "Дата сохранится, но напоминания не придут, пока вы не разрешите уведомления для приложения в настройках телефона.",
        );
      }
    }
    save.mutate(ev);
  };

  const askRemove = () => {
    if (!draft?.id) return;
    const id = draft.id;
    confirmDestructive(
      "Удалить дату?",
      `«${draft.title.trim() || "Без названия"}» исчезнет вместе с напоминаниями.`,
      () => {
        remove.mutate(id);
        setDraft(null);
      },
      "Удалить",
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.monthTitle}>{monthTitle(view.y, view.m)}</Text>
        <View style={styles.headerActions}>
          {!isCurrentMonth && (
            <Pressable
              onPress={() => setView({ y: now.y, m: now.m })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Вернуться к текущему месяцу"
              style={({ pressed }) => [styles.todayBtn, pressed && styles.dimmed]}
            >
              <Feather name="calendar" size={12} color={colors.accentGreen} />
              <Text style={styles.todayBtnText}>Сегодня</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => moveMonth(-1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Предыдущий месяц"
            style={({ pressed }) => pressed && styles.dimmed}
          >
            <Feather name="chevron-left" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={() => moveMonth(1)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Следующий месяц"
            style={({ pressed }) => pressed && styles.dimmed}
          >
            <Feather name="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS_SHORT.map((w) => (
          <Text key={w} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      {/* Шесть недель всегда: см. monthGrid. */}
      {Array.from({ length: 6 }, (_, row) => (
        <View key={row} style={styles.weekRow}>
          {grid.slice(row * 7, row * 7 + 7).map((cell) => {
            const list = byDay.get(cell.key);
            const isToday = cell.key === today;
            const isSelected = cell.key === selected;
            return (
              <Pressable
                key={cell.key}
                onPress={() => pickDay(cell.key, cell.inMonth)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${formatDay(cell.key, { weekday: true })}${
                  list ? `, дат: ${list.length}` : ""
                }`}
                style={styles.cell}
              >
                <View style={[styles.dayNum, isToday && styles.dayNumToday, isSelected && styles.dayNumSelected]}>
                  <Text
                    style={[
                      styles.dayText,
                      !cell.inMonth && styles.dayTextOut,
                      (isToday || isSelected) && styles.dayTextStrong,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {list?.slice(0, 3).map((e) => <View key={e.id} style={styles.dot} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.divider} />

      {selected ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{formatDay(selected, { weekday: true })}</Text>
            <Pressable
              onPress={() => setSelected(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Снять выбор дня"
            >
              <Feather name="x" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          {dayEvents.length === 0 ? (
            <Text style={styles.empty}>В этот день ничего нет</Text>
          ) : (
            dayEvents.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                sub={[e.time ?? "Весь день", repeatLabel(e.repeat)].filter(Boolean).join(" · ")}
                onPress={() => openEdit(e)}
              />
            ))
          )}
        </View>
      ) : (
        <View style={styles.section}>
          <Pressable
            onPress={() => setSoonOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: soonOpen }}
            accessibilityLabel={soonOpen ? "Свернуть ближайшие даты" : "Развернуть ближайшие даты"}
            style={({ pressed }) => [styles.collapseHead, soonOpen && styles.collapseHeadOpen, pressed && styles.dimmed]}
          >
            <Text style={styles.sectionTitleBare}>Ближайшие</Text>
            <Feather name={soonOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
          </Pressable>
          {soonOpen &&
            (soon.length === 0 ? (
              <Text style={styles.empty}>Пока ни одной даты. Нажмите на день, чтобы добавить.</Text>
            ) : (
              soon.map((u) => (
                <EventRow
                  key={`${u.event.id}:${u.date}`}
                  event={u.event}
                  sub={[formatDay(u.date), u.event.time, repeatLabel(u.event.repeat)].filter(Boolean).join(" · ")}
                  right={relativeLabel(today, u.date)}
                  onPress={() => openEdit(u.event)}
                />
              ))
            ))}
        </View>
      )}

      <Pressable
        onPress={openNew}
        accessibilityRole="button"
        accessibilityLabel={selected ? "Добавить дату на выбранный день" : "Добавить дату"}
        style={({ pressed }) => [styles.addRow, pressed && styles.dimmed]}
      >
        <Feather name="plus" size={16} color={colors.textMuted} />
        <Text style={styles.addText}>{selected ? "Добавить на этот день" : "Добавить дату"}</Text>
      </Pressable>

      {draft && (
        <EventEditor
          draft={draft}
          onChange={setDraft}
          onSave={submit}
          onCancel={() => setDraft(null)}
          onDelete={draft.id ? askRemove : null}
        />
      )}
    </View>
  );
}

function EventRow({
  event,
  sub,
  right,
  onPress,
}: {
  event: DateEvent;
  sub: string;
  right?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}. ${sub}. Изменить`}
      style={({ pressed }) => [styles.eventRow, pressed && styles.dimmed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={styles.eventSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {event.leads.length > 0 && <Feather name="bell" size={12} color={colors.textMuted} />}
      {right && <Text style={styles.eventRight}>{right}</Text>}
    </Pressable>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function EventEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (() => void) | null;
}) {
  const canSave = draft.title.trim() !== "";
  const allowed = availableLeads(draft.time);
  const allOn = allowed.every((l) => draft.leads.includes(l));
  const date = parseKey(draft.date)!;
  const [hh, mm] = (draft.time ?? "09:00").split(":").map(Number);

  const setDate = (key: string) => onChange({ ...draft, date: key });
  const setTime = (h: number, m: number) => onChange({ ...draft, time: `${pad2(h)}:${pad2(m)}` });

  const toggleLead = (id: Lead) => {
    const next = draft.leads.includes(id) ? draft.leads.filter((l) => l !== id) : [...draft.leads, id];
    // В порядке списка, а не порядка нажатий: так сохранённое выглядит одинаково.
    onChange({ ...draft, leads: LEADS.map((l) => l.id).filter((l) => next.includes(l)) });
  };

  const setTimeEnabled = (on: boolean) =>
    onChange({
      ...draft,
      time: on ? "09:00" : null,
      // «За час» без времени бессмысленно: от условных девяти утра это восемь.
      leads: on ? draft.leads : draft.leads.filter((l) => l !== "hour"),
    });

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.topBar}>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Закрыть без сохранения"
              style={({ pressed }) => [styles.topBtn, pressed && styles.dimmed]}
            >
              <Feather name="x" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.topTitle}>{draft.id ? "Изменить дату" : "Новая дата"}</Text>
            {/* Пустое место справа держит заголовок по центру. */}
            <View style={styles.topBtn} />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <TextInput
              value={draft.title}
              onChangeText={(title) => onChange({ ...draft, title })}
              placeholder="Например, день рождения Ани"
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_TITLE}
              autoFocus={draft.id === null}
              style={styles.titleInput}
              accessibilityLabel="Название"
              returnKeyType="done"
            />

            <Text style={styles.label}>Дата</Text>
            <View style={styles.stepRow}>
              <Stepper
                name="День"
                label={String(date.d)}
                width={28}
                onDec={() => setDate(addDays(draft.date, -1))}
                onInc={() => setDate(addDays(draft.date, 1))}
              />
              <Stepper
                name="Месяц"
                label={monthName(date.m)}
                width={70}
                onDec={() => setDate(shiftMonth(draft.date, -1))}
                onInc={() => setDate(shiftMonth(draft.date, 1))}
              />
              <Stepper
                name="Год"
                label={String(date.y)}
                width={42}
                onDec={() => setDate(shiftYear(draft.date, -1))}
                onInc={() => setDate(shiftYear(draft.date, 1))}
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.label}>Время</Text>
              <Switch
                value={draft.time !== null}
                onValueChange={setTimeEnabled}
                trackColor={{ true: withAlpha(colors.accentGreen, 0.5), false: colors.cardBorder }}
                thumbColor={draft.time !== null ? colors.accentGreen : colors.textMuted}
                accessibilityLabel="Указать время"
              />
            </View>
            {draft.time !== null ? (
              <View style={styles.stepRow}>
                <Stepper
                  name="Часы"
                  label={pad2(hh)}
                  width={24}
                  onDec={() => setTime((hh + 23) % 24, mm)}
                  onInc={() => setTime((hh + 1) % 24, mm)}
                />
                <Text style={styles.colon}>:</Text>
                <Stepper
                  name="Минуты"
                  label={pad2(mm)}
                  width={24}
                  onDec={() => setTime(hh, (mm + 55) % 60)}
                  onInc={() => setTime(hh, (mm + 5) % 60)}
                />
              </View>
            ) : (
              <Text style={styles.hint}>На весь день — напомним в 9:00.</Text>
            )}

            <Text style={styles.label}>Повтор</Text>
            <View style={styles.chipRow}>
              {REPEATS.map((r) => {
                const on = draft.repeat === r.id;
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => onChange({ ...draft, repeat: r.id })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.dimmed]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {draft.repeat !== "none" && <Text style={styles.hint}>Считается от даты выше.</Text>}

            <Text style={styles.label}>Напомнить</Text>
            <View style={styles.chipRow}>
              {LEADS.filter((l) => allowed.includes(l.id)).map((l) => {
                const on = draft.leads.includes(l.id);
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => toggleLead(l.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.dimmed]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{l.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => onChange({ ...draft, leads: allOn ? [] : allowed })}
                accessibilityRole="button"
                accessibilityLabel={allOn ? "Снять все напоминания" : "Выбрать все напоминания"}
                style={({ pressed }) => [styles.chip, allOn && styles.chipOn, pressed && styles.dimmed]}
              >
                <Text style={[styles.chipText, allOn && styles.chipTextOn]}>Все сразу</Text>
              </Pressable>
            </View>
            {draft.leads.length === 0 && (
              <Text style={styles.hint}>Без напоминаний — дата просто отметится в календаре.</Text>
            )}
          </ScrollView>

          {/* Внизу и вне прокрутки: кнопка под большим пальцем и над клавиатурой, а не в конце длинной формы. */}
          <View style={styles.bottomBar}>
            {onDelete && (
              <Pressable
                onPress={onDelete}
                accessibilityRole="button"
                style={({ pressed }) => [styles.deleteBtn, pressed && styles.dimmed]}
              >
                <Feather name="trash-2" size={16} color={colors.accent} />
                <Text style={styles.deleteText}>Удалить</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              style={({ pressed }) => [styles.saveBtn, !canSave && styles.saveBtnOff, pressed && styles.dimmed]}
            >
              <Text style={styles.saveText}>Сохранить</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Stepper({
  name,
  label,
  width,
  onDec,
  onInc,
}: {
  name: string;
  label: string;
  width: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onDec}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${name}: меньше`}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
      >
        <Feather name="chevron-left" size={16} color={colors.text} />
      </Pressable>
      <Text style={[styles.stepValue, { minWidth: width }]}>{label}</Text>
      <Pressable
        onPress={onInc}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${name}: больше`}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
      >
        <Feather name="chevron-right" size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    marginBottom: 10,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  monthTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  // Выглядит кнопкой, а не подписью: рамка, заливка и значок. Серый текст без всего этого
  // сливался с заголовком месяца, и было не понять, что на него можно нажать.
  todayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(143,184,154,0.12)",
  },
  todayBtnText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: colors.textMuted, fontSize: 11, marginTop: 10, marginBottom: 2 },
  cell: { flex: 1, height: 42, alignItems: "center", paddingTop: 2 },
  dayNum: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  // Сегодня — нейтральное кольцо: зелёный в приложении значит «сделано», а не «этот день».
  dayNumToday: { borderWidth: 1, borderColor: colors.textMuted },
  dayNumSelected: { backgroundColor: withAlpha(colors.accent, 0.22) },
  dayText: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  dayTextOut: { color: colors.textMuted, opacity: 0.45 },
  dayTextStrong: { fontWeight: "600" },
  dots: { flexDirection: "row", gap: 3, height: 5, marginTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginTop: 6, marginBottom: 10 },
  section: { paddingHorizontal: 4 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  collapseHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  collapseHeadOpen: { marginBottom: 4 },
  sectionTitleBare: { color: colors.textMuted, fontSize: 12 },
  empty: { color: colors.textMuted, fontSize: 12, lineHeight: 17, paddingVertical: 6 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  eventTitle: { color: colors.text, fontSize: 14 },
  eventSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  eventRight: { color: colors.accent, fontSize: 12, fontVariant: ["tabular-nums"] },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderStyle: "dashed",
  },
  addText: { color: colors.textMuted, fontSize: 13 },
  dimmed: { opacity: 0.7 },

  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, height: 52 },
  topBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 4 },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  titleInput: {
    color: colors.text,
    fontSize: 17,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 6,
  },
  label: { color: colors.textMuted, fontSize: 11, marginTop: 12, marginBottom: 6 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  colon: { color: colors.textMuted, fontSize: 15 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { color: colors.text, fontSize: 14, fontWeight: "600", textAlign: "center", fontVariant: ["tabular-nums"] },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12, paddingRight: 6 },
  deleteText: { color: colors.accent, fontSize: 14 },
  saveBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: "rgba(143,184,154,0.16)",
    borderWidth: 1,
    borderColor: colors.accentGreen,
  },
  saveBtnOff: { opacity: 0.4 },
  saveText: { color: colors.accentGreen, fontSize: 15, fontWeight: "600" },
});
