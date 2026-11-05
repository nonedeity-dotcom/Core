import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, levelInk, levelTint } from "../theme/colors";
import { confirmDestructive } from "../lib/confirm";
import { useTodayKey } from "../lib/useTodayKey";
import { useNowMinutes } from "../lib/useNowMinutes";
import { DEFAULT_LATE_RULE, type LateRule } from "../lib/habitSchedule";
import { dayOffReason, isDayOff } from "../lib/dayOff";
import { plural } from "../lib/plural";
import {
  LEVELS,
  LEVEL_LABELS,
  LEVEL_SHORT,
  capQuota,
  closedLevels,
  countLevels,
  habitLevel,
  meetsQuota,
  quotaIsEmpty,
  weeklyLevels,
  type LevelQuota,
  type HabitLevel,
} from "../lib/level";
import { useFoldSet } from "../lib/useFold";
import { weekStart, weekDatesThrough } from "../lib/week";
import { habitStanding, standingRank, type HabitStanding } from "../lib/habitStanding";
import {
  MINUTES_IN_DAY,
  canMarkNow,
  formatSchedule,
  formatWindow,
  normalizeSchedule,
} from "../lib/habitSchedule";
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
import { refreshScreenHabits } from "../integrations/screenTime";
import { TOTAL_APP, isTotal, ruleDirection, type ScreenDirection, type ScreenRule } from "../lib/screenTime";
import { shiftDate } from "../lib/date";
import { openIcons, type IconName } from "../lib/rewards/icons";
import type { Purse } from "../lib/rewards/currency";
import { totalsByApp } from "../lib/screen/usage";
import { formatMinutes } from "../lib/stats";
import type { AppDay } from "../lib/screen/usage";
import type { Habit, HabitLog, HabitSchedule, HabitTarget, ItemGroup } from "../types";

/**
 * The three piles, in the order they are shown. Only the first decides the day; the reason
 * for the split is that a list of ten things you eventually want is not a list of ten things
 * you are doing, and judging today against the whole list makes the list unusable.
 */
/**
 * Из скольких приложений выбирать и за какой срок их считать.
 *
 * Месяц и два десятка: выбирают из своих, а своих столько и есть. Полный список
 * установленного — это полсотни строк, из которых сорок восемь человек не открывал.
 */
const APP_PICKER_DAYS = 30;
const APP_PICKER_LIMIT = 20;

/** Лимит экранной привычки: шаг, начальное значение и потолок. */
const SCREEN_LIMIT_STEP_MIN = 30;
/**
 * Шаг помельче — для коротких планок.
 *
 * Полчаса хороши для «TikTok не больше пяти часов», но «читалка хотя бы двадцать минут»
 * ими не выставить вовсе: ступени шли 30, 60, 90. До часа шаг десять минут.
 */
const SCREEN_LIMIT_FINE_STEP_MIN = 10;
const SCREEN_LIMIT_FINE_UNTIL_MIN = 60;
const DEFAULT_SCREEN_HABIT_LIMIT_MIN = 120;
const DEFAULT_SCREEN_HABIT_MINIMUM_MIN = 20;
const MAX_SCREEN_HABIT_LIMIT_MIN = 16 * 60;

/** Один шаг отметки: сколько раз и с каким вариантом. Несколько шагов идут одной мутацией. */
type BumpStep = { habit: Habit; minimal?: boolean; times?: number };

/**
 * Все записи отметок — нажатие, закрытие родителя, сброс — идут через одну очередь.
 *
 * Раньше каждая мутация ходила на сервер сама по себе. Сбросил подзадачу и тут же отметил
 * её снова — два запроса обгоняли друг друга: отметка могла дойти раньше сброса и тут же
 * им стереться. На экране это выглядело как «родитель зелёный, а подзадача не выполнена».
 * Очередь держит порядок записей ровно таким, каким были нажатия.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task);
  // Упавшая запись не должна заклинивать очередь для следующих.
  writeQueue = run.catch(() => undefined);
  return run;
}

/**
 * «Без уровня» — привычка не участвует в норме по уровням и метки не показывает.
 * Это не уровень из LEVELS (те считаются в норме), а отдельное значение, поэтому оно
 * живёт здесь, а не в списке, по которому строятся чипы нормы.
 */
const NO_LEVEL = "none";
type LevelChoice = HabitLevel | typeof NO_LEVEL;
const hasLevel = (l: LevelChoice): l is HabitLevel => l !== NO_LEVEL;

/**
 * Уровень привычки так, как его выбирают в редакторе и рисуют в строке.
 *
 * «Без уровня» — состояние по умолчанию: у привычки, которой уровень не ставили, поле пустое,
 * и редактор открывается на «Без уровня», а в строке нет метки. Раньше туда подставлялся
 * уровень «по умолчанию» из habitLevel, и «ничего не отображать» было не выбрать — после
 * сохранения метка возвращалась. Смотрим на сохранённое значение: не из LEVELS — значит,
 * без уровня.
 */
const levelChoiceOf = (h: Habit): LevelChoice => {
  const raw = (h as unknown as { level?: string | null }).level;
  if (!raw || !(LEVELS as readonly string[]).includes(raw)) return NO_LEVEL;
  return habitLevel(h) as LevelChoice;
};

const GROUPS: { id: ItemGroup; title: string; blurb: string }[] = [
  { id: "now", title: "Ввожу сейчас", blurb: "по ним засчитывается день — держи этот список коротким" },
  { id: "extra", title: "Дополнительно", blurb: "можно отмечать, на зачёт дня не влияет" },
  { id: "later", title: "Потом", blurb: "план на будущее, отмечать пока нечего" },
];

/** Почему клиент отказал сделать привычку подзадачей. С экрана до этих случаев почти не дойти. */
const MAKE_SUBTASK_ERRORS: Record<string, string> = {
  not_found: "Привычка или её новый родитель уже не найдены — возможно, их убрали в архив.",
  same: "Привычку нельзя сделать подзадачей самой себя.",
  already_subtask: "Это уже подзадача.",
  has_subtasks: "У этой привычки есть свои подзадачи — сначала разберись с ними.",
  parent_is_subtask: "Подзадача не может быть родителем: вложенность только в один уровень.",
};

export default function TodayScreen() {
  const [newSubtaskParentId, setNewSubtaskParentId] = useState<string | null>(null);
  const qc = useQueryClient();
  const today = useTodayKey();
  // Re-reads once a minute, so a window closing at 23:00 closes on the screen you are
  // looking at rather than on the next thing that happens to re-render.
  const minutes = useNowMinutes();
  const { data: lateRule = DEFAULT_LATE_RULE } = useQuery<LateRule>({
    queryKey: ["lateRule"],
    queryFn: () => api.getLateRule(),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Whether the per-row controls and the add row are on show. Off by default. */
  const [editing, setEditing] = useState(false);
  const [editHasSubtasks, setEditHasSubtasks] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editMinimal, setEditMinimal] = useState("");
  const [editGroup, setEditGroup] = useState<ItemGroup>("now");
  const [editLevel, setEditLevel] = useState<LevelChoice>(NO_LEVEL);
  const [editTarget, setEditTarget] = useState<HabitTarget>({ kind: "daily", count: 1 });
  const [editSchedule, setEditSchedule] = useState<HabitSchedule | null>(null);
  /** Правило «считать из Creker». null — привычка отмечается руками, как все остальные. */
  const [editScreen, setEditScreen] = useState<ScreenRule | null>(null);
  /** Значок привычки. null — без значка, и это нормальное состояние, а не пропуск. */
  const [editIcon, setEditIcon] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  /** Какая привычка сейчас выбирает, внутрь какой другой переехать. null — никакая. */
  const [movingId, setMovingId] = useState<string | null>(null);
  /*
   * Какие кучки раскрыты. «Ввожу сейчас» раскрыта всегда — это и есть список дня, прятать его
   * незачем. «Дополнительно» и «Потом» по умолчанию свёрнуты: по ним день не решается, и два
   * длинных списка под главным только отодвигали то, ради чего экран открывают.
   */
  const [openGroups, setOpenGroups] = useState<ItemGroup[]>([]);
  const toggleGroup = (id: ItemGroup) =>
    setOpenGroups((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // One per group, and closed again the moment you leave the tab.
  const folds = useFoldSet();
  /*
   * Какие привычки раскрыты (показывают подзадачи) — хранится здесь, а не в самой строке.
   *
   * Строка переезжает между «Осталось» и «Выполнено», когда закрывается последняя подзадача
   * или когда её сбрасывают, и при переезде пересоздаётся. Состояние внутри строки при этом
   * терялось: список подзадач схлопывался сам, «на секунду что-то происходило». Здесь оно
   * переживает любые переезды.
   */
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const setExpandedFor = (id: string, open: boolean) =>
    setExpandedIds((prev) => (open ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });

  /*
   * Список приложений для выбора — из того, чем человек пользовался за месяц.
   *
   * Не все установленные и не алфавит: выбирают из своих, а своих обычно два десятка. То,
   * что ни разу не открывалось, в такой привычке и не нужно — ограничивать нечего.
   */
  const { data: appRows = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", "picker", today],
    queryFn: () => api.getScreenApps(shiftDate(today, -APP_PICKER_DAYS), today),
    enabled: editingId !== null,
  });
  const appChoices = totalsByApp(appRows).slice(0, APP_PICKER_LIMIT);

  // Значки — только из купленных наборов. Читается лениво: до открытия редактора они не нужны.
  const { data: purse } = useQuery<Purse>({
    queryKey: ["purse"],
    queryFn: () => api.getPurse(),
    enabled: editingId !== null,
  });
  const iconChoices = openIcons(purse?.owned ?? []);

  /*
   * Сколько уже потрачено сегодня — для строки «1 ч 12 мин из 5 ч».
   *
   * Читается один раз на весь экран и раскладывается по привычкам здесь: запрос на каждую
   * строку означал бы пять чтений одной и той же таблицы ради пяти разных её кусков.
   */
  const watching = habits.filter((h) => h.auto === "screentime" && h.screen);
  const { data: todayScreen } = useQuery<{ total: number | null; byApp: Record<string, number> }>({
    queryKey: ["screenToday", today],
    queryFn: async () => {
      const [days, apps] = await Promise.all([api.getScreenDays(today, today), api.getScreenApps(today, today)]);
      const day = days.find((d) => d.date === today);
      const byApp: Record<string, number> = {};
      for (const a of apps) byApp[a.packageName] = (byApp[a.packageName] ?? 0) + a.usageMillis;
      return { total: day ? day.screenMillis : null, byApp };
    },
    enabled: watching.length > 0,
  });

  /** Минуты за сегодня по правилу привычки. `null` — за день ещё ничего не намерено. */
  const usedFor = (rule: ScreenRule): number | null => {
    if (!todayScreen || todayScreen.total === null) return null;
    const millis = isTotal(rule) ? todayScreen.total : (todayScreen.byApp[rule.app] ?? 0);
    return Math.round(millis / 60_000);
  };

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
  const { logs: streakLogs, freezes, habitFreezes, skipRule, daysOff, levelRule } = useStreak(today);

  // How much of the pile closes a day is a setting; the header is the one place on this
  // screen that has to say what today is actually asking for.
  const { data: dayRule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });

  const invalidateHabits = () => qc.invalidateQueries({ queryKey: ["habits"] });

  /*
   * Сколько записей отметок сейчас в полёте.
   *
   * Перезагрузка нужна один раз — когда записано всё. Если каждая запись перезагружала сама,
   * то перезагрузка первой приходила со старыми данными, пока вторая ещё писалась, и
   * затирала оптимистичное состояние: на секунду всё откатывалось и прыгало обратно.
   * Теперь перезагружает только последняя. Она же заодно и откатывает то, что сервер
   * не принял, — отдельный откат по снимку при нескольких записях сам бы ломал картину.
   */
  const pendingWrites = useRef(0);
  const finishWrite = () => {
    pendingWrites.current = Math.max(0, pendingWrites.current - 1);
    if (pendingWrites.current > 0) return Promise.resolve();
    // The whole habitLog prefix: the report keeps its own week and streak queries, and
    // ticking here used to leave them showing yesterday's numbers.
    return qc.invalidateQueries({ queryKey: ["habitLog"] });
  };

  /*
   * Пересчёт идёт и тогда, когда правило только что поменяли.
   *
   * Сначала он смотрел лишь на число привычек и на дату — и привычка, которой прямо сейчас
   * включили «считать из Creker», оставалась неотмеченной до следующего захода на вкладку.
   * Выглядело это как «включил, и ничего не произошло», хотя данные за день уже лежали
   * рядом. Поэтому в зависимостях слепок самих правил, а не их количество.
   */
  const screenStamp = habits
    .map((h) =>
      h.auto === "screentime" && h.screen ? `${h.id}:${h.screen.app}:${h.screen.limitMin}:${ruleDirection(h.screen)}` : "",
    )
    .join("|");

  useEffect(() => {
    if (habits.length === 0) return;
    refreshScreenHabits(habits, today).then((ticked) => {
      // Цифры за день тоже обновились — строка «1 ч 12 мин из 5 ч» должна их увидеть.
      qc.invalidateQueries({ queryKey: ["screenToday"] });
      if (ticked > 0) qc.invalidateQueries({ queryKey: ["habitLog"] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits.length, today, screenStamp]);

  /**
   * One tap: one step up, stopping at the target. It never steps back — that was the whole
   * complaint about the old checkbox, where the same tap that marked a habit done also
   * un-did it. Correcting a mis-tap lives in edit mode instead.
   */
  /*
   * Подзадача и родитель закрываются ОДНОЙ мутацией, а запросы идут по очереди.
   *
   * Раньше это были два отдельных `bump.mutate` подряд: первый уже на сервере и сразу
   * запускал перезагрузку отметок, пока второй ещё летел. Перезагрузка приходила со
   * старыми данными и затирала оптимистичную отметку — родитель горел зелёным, а
   * подзадача писала «не выполнена». Теперь кэш обновляется за один раз, перезагрузка
   * одна и только после того, как всё записано.
   */
  const bump = useMutation({
    mutationFn: (steps: BumpStep[]) =>
      enqueueWrite(async () => {
        for (const { habit, minimal, times = 1 } of steps) {
          for (let i = 0; i < times; i++) {
            await api.bumpHabit(habit.id, today, perDayTarget(habit), minimal ?? false);
          }
        }
      }),
    // Optimistic, so the number moves under the finger instead of after a round trip.
    onMutate: async (steps) => {
      pendingWrites.current += 1;
      await qc.cancelQueries({ queryKey: ["habitLog", today] });
      const prev = qc.getQueryData<HabitLog[]>(["habitLog", today]) || [];
      let rows = prev;
      for (const { habit, minimal, times = 1 } of steps) {
        const target = perDayTarget(habit);
        const current = logCount(rows.find((l) => l.habitId === habit.id));
        const next = Math.min(target, current + times);
        const done = next >= target;
        rows = rows.some((l) => l.habitId === habit.id)
          ? rows.map((l) => (l.habitId === habit.id ? { ...l, count: next, done, minimal: done && !!minimal } : l))
          : [...rows, { id: "temp", habitId: habit.id, date: today, count: next, done, minimal: done && !!minimal }];
      }
      qc.setQueryData(["habitLog", today], rows);
    },
    onSettled: finishWrite,
  });

  /*
   * Сброс за сегодня — тоже оптимистичный и тоже одной мутацией на всех.
   *
   * Без оптимизма после нажатия секунду ничего не менялось, а потом всё прыгало разом:
   * строка оставалась «выполненной», пока не придёт перезагрузка. Теперь отметки
   * пропадают сразу, а если сервер откажет — возвращаются.
   */
  const resetDay = useMutation({
    mutationFn: (habitIds: string[]) =>
      enqueueWrite(async () => {
        for (const id of habitIds) await api.resetHabitDay(id, today);
      }),
    onMutate: async (habitIds) => {
      pendingWrites.current += 1;
      await qc.cancelQueries({ queryKey: ["habitLog", today] });
      const prev = qc.getQueryData<HabitLog[]>(["habitLog", today]) || [];
      qc.setQueryData(
        ["habitLog", today],
        prev.filter((l) => !habitIds.includes(l.habitId)),
      );
    },
    onSettled: finishWrite,
  });

// Отметка берётся только за сегодня: в allLogs лежат 4 месяца, и find вернул бы самую старую запись.
  const isDoneToday = (id: string) => !!logs.find((l) => l.habitId === id)?.done;

  const handleBump = (habit: Habit, minimal: boolean = false) => {
    // Подзадача
    if (habit.parentId) {
      // Уже отмечена — в обычном режиме не снимается
      if (isDoneToday(habit.id)) return;

      const steps: BumpStep[] = [{ habit, minimal: false }];

      // Остальные подзадачи тоже готовы — родитель закрывается сам. Если у самой подзадачи
      // цель больше одного раза, этот тап её ещё не закрывает — тогда и родителю рано.
      const parent = habits.find((h) => h.id === habit.parentId);
      const siblings = habits.filter((h) => h.parentId === habit.parentId);
      const closesThis = logCount(logs.find((l) => l.habitId === habit.id)) + 1 >= perDayTarget(habit);
      const othersDone = siblings.every((s) => s.id === habit.id || isDoneToday(s.id));
      if (closesThis && othersDone && parent && !isDoneToday(parent.id)) {
        // Родитель добирается до своей цели целиком, а не на один шаг.
        const left = perDayTarget(parent) - logCount(logs.find((l) => l.habitId === parent.id));
        steps.push({ habit: parent, minimal: false, times: Math.max(1, left) });
      }
      bump.mutate(steps);
      return;
    }

    // Родитель с подзадачами: пока не готовы все подзадачи, отметить нельзя
    const subs = habits.filter((h) => h.parentId === habit.id);
    if (subs.length > 0 && !subs.every((s) => isDoneToday(s.id))) return;

    bump.mutate([{ habit, minimal }]);
  };

  // Сброс подзадачи в режиме «Изменить»; закрытый родитель тоже сбрасывается
  const handleResetSubtask = (sub: Habit) => {
    const ids = [sub.id];
    const parent = habits.find((h) => h.id === sub.parentId);
    if (parent && logCount(logs.find((l) => l.habitId === parent.id)) > 0) ids.push(parent.id);
    resetDay.mutate(ids);
  };

  // Сброс привычки за сегодня; у родителя сбрасываются и подзадачи
  const handleResetHabit = (h: Habit) => {
    const ids = habits
      .filter((s) => s.parentId === h.id && logCount(logs.find((l) => l.habitId === s.id)) > 0)
      .map((s) => s.id);
    resetDay.mutate([...ids, h.id]);
  };
  const addHabit = useMutation({
  // Теперь принимаем объект, чтобы можно было передать parentId
  mutationFn: (data: { label: string; parentId?: string }) =>
    api.addHabit(data.label, undefined, data.parentId),
  onSuccess: () => {
    setNewLabel("");
    setAdding(false);
    setNewSubtaskParentId(null); // Сбрасываем ID родителя после создания
    invalidateHabits();
  },
});

  const updateHabit = useMutation({
    mutationFn: (data: {
      hasSubtasks: boolean;
      id: string;
      label: string;
      minimal: string | null;
      group: ItemGroup;
      level: HabitLevel;
      target: HabitTarget;
      schedule: HabitSchedule | null;
      screen: ScreenRule | null;
      icon: string | null;
    }) =>
      api.updateHabit(data.id, {
        hasSubtasks: data.hasSubtasks,
        label: data.label,
        minimal: data.minimal,
        group: data.group,
        level: data.level,
        target: data.target,
        schedule: data.schedule,
        screen: data.screen,
        icon: data.icon,
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidateHabits();
      // The day's verdict depends on which pile a habit is in and what it is owed.
      qc.invalidateQueries({ queryKey: ["habitLog"] });
    },
  });

  /*
   * Привычка → подзадача. Отметки не трогаются: они лежат под id привычки, а он не меняется,
   * так что вся история переезжает вместе с ней. Саму запись делает клиент одним вызовом —
   * см. api.makeSubtask, там же объяснено, почему не двумя updateHabit подряд.
   */
  const makeSubtask = useMutation({
    mutationFn: (v: { id: string; parentId: string }) => api.makeSubtask(v.id, v.parentId),
    onSuccess: (res, v) => {
      setMovingId(null);
if (!res.ok) {
  Alert.alert("Не получилось", MAKE_SUBTASK_ERRORS[res.reason] ?? "Не удалось сделать подзадачей.");
  return;
}

      // Показать, куда она уехала: раскрыть кучку родителя и самого родителя, иначе привычка
      // просто исчезла бы из списка, а искать её пришлось бы в свёрнутом.
      const parent = habits.find((h) => h.id === v.parentId);
      if (parent) {
        const g = habitGroup(parent);
        setOpenGroups((prev) => (prev.includes(g) ? prev : [...prev, g]));
      }
      setExpandedFor(v.parentId, true);
      invalidateHabits();
      // Привычка перестала решать день сама по себе — приговор дня надо пересчитать.
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
    setEditLevel(levelChoiceOf(h));
    setEditTarget(habitTarget(h));
    setEditSchedule(h.schedule ?? null);
    setEditScreen(h.screen ?? null);
    setEditIcon(h.icon ?? null);
    setEditHasSubtasks(h.hasSubtasks ?? false);
  };

  const saveEdit = () => {
    if (editingId && editDraft.trim()) {
      updateHabit.mutate({
        id: editingId,
        label: editDraft.trim(),
        // Empty means "no minimal version", not an empty string to render.
        minimal: editMinimal.trim() || null,
        group: editGroup,
        // «Без уровня» — отдельное значение, которого может не быть в типе HabitLevel из lib/level.
        level: editLevel as HabitLevel,
        target: editTarget,
        schedule: editSchedule,
        screen: editScreen,
        icon: editIcon,
        hasSubtasks: editHasSubtasks,
      });
    } else setEditingId(null);
  };

  const submitNew = () => {
  if (newLabel.trim()) {
    addHabit.mutate({ 
      label: newLabel.trim(), 
      parentId: newSubtaskParentId || undefined 
    });
  } else {
    setAdding(false);
    setNewSubtaskParentId(null);
  }
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
        daysOff,
      today,
      excused: frozenDaysFor(h.id, freezes, habitFreezes),
      own: habitFreezes[h.id] ?? [],
      rule: skipRule,
      weekDates,
      nowMinutes: minutes,
      lateRule,
    });

  const nowHabits = habits.filter((h) => habitGroup(h) === "now" && !h.parentId);
  const deciding = habitsThatDecideTheDay(habits.filter (h => !
h.parentId));
  const closed = deciding.filter((h) => logCount(logs.find((l) => l.habitId === h.id)) >= perDayTarget(h)).length;
  const required = requiredForDay(dayRule, deciding.length);

  // Норма по уровням — вторая половина того же приговора дня. Считается здесь, потому что
  // здесь же стоит и первая: два числа, которые решают день, человек должен видеть рядом,
  // а не на разных экранах.
  const isClosedToday = (h: Habit) => logCount(logs.find((l) => l.habitId === h.id)) >= perDayTarget(h);
  const dailyQuota = capQuota(levelRule.daily, countLevels(deciding));
  const dailyClosed = closedLevels(deciding, isClosedToday);
  // За неделю считаются дни, а не нажатия, и в счёт идут все привычки «ввожу сейчас» —
  // недельные тоже: «спорт три раза в неделю» это ровно то, что осмысленно мерить неделей.
  const weekClosedDays = (h: Habit) => {
    const perDay = perDayTarget(h);
    return weekDates.filter((d) => logCount(weekLogs.find((l) => l.habitId === h.id && l.date === d)) >= perDay)
      .length;
  };
  const weeklyClosed = weeklyLevels(nowHabits, weekClosedDays);

  /*
   * Форма новой привычки и форма новой подзадачи — одна и та же, различаются подсказкой и
   * местом. Привычка добавляется сверху, а подзадача — прямо в панели своего родителя:
   * форма наверху, пока родитель где-то посередине списка, осталась бы за краем экрана.
   */
  const renderNewForm = (inline: boolean) => (
    <View style={[styles.card, styles.cardEditing, inline && { marginBottom: 0 }]}>
      <TextInput
        value={newLabel}
        onChangeText={setNewLabel}
        autoFocus
        placeholder={newSubtaskParentId ? "Новая подзадача…" : "Новая привычка…"}
        placeholderTextColor={colors.textMuted}
        style={styles.editInput}
        onSubmitEditing={submitNew}
      />
      <Pressable
        onPress={submitNew}
        style={styles.iconBtn}
        accessibilityLabel={newSubtaskParentId ? "Сохранить подзадачу" : "Сохранить привычку"}
      >
        <Feather name="check" size={16} color={colors.accentGreen} />
      </Pressable>
      <Pressable
        onPress={() => {
          setAdding(false);
          setNewSubtaskParentId(null);
        }}
        style={styles.iconBtn}
        accessibilityLabel="Отменить"
      >
        <Feather name="x" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );

    // Один и тот же редактор для привычки и для подзадачи.
  const renderEditor = (id: string, isSubtask: boolean) => (
    <HabitEditor
      key={id}
      label={editDraft}
      onLabel={setEditDraft}
      minimal={editMinimal}
      onMinimal={setEditMinimal}
      group={editGroup}
      onGroup={setEditGroup}
      level={editLevel}
      onLevel={setEditLevel}
      target={editTarget}
      onTarget={setEditTarget}
      schedule={editSchedule}
      onSchedule={setEditSchedule}
      screen={editScreen}
      onScreen={setEditScreen}
      apps={appChoices}
      icon={editIcon}
      onIcon={setEditIcon}
      icons={iconChoices}
      onSave={saveEdit}
      onCancel={() => setEditingId(null)}
      hasSubtasks={editHasSubtasks}
      onHasSubtasks={setEditHasSubtasks}
      isSubtask={isSubtask}
    />
  );
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>
      {/* Чек-лист в выходной не прячется: захочется — отметишь, но никто не просит.
          Спрятать список значило бы решить за человека, что в выходной он ничего не
          сделает, а это его дело, а не приложения. */}
      {isDayOff(today, daysOff) && (
        <View style={styles.dayOffCard}>
          <Feather name="coffee" size={14} color={colors.accentGreen} />
          <Text style={styles.dayOffText}>
            {dayOffReason(today, daysOff) === "weekday"
              ? "Сегодня выходной — постоянный. Серия не прервётся и шанс не потратится."
              : "Сегодня выходной. Серия не прервётся и шанс не потратится."}
          </Text>
        </View>
      )}

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
            setNewSubtaskParentId(null);
            setMovingId(null);
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

      {/* Добавление — это правка, поэтому появляется вместе с остальными правками, но теперь
          наверху: в длинном списке кнопку внизу приходилось искать прокруткой. Пока идёт
          добавление подзадачи, форма стоит внутри её родителя, а здесь ничего нет. */}
      {(editing || adding) && !(adding && newSubtaskParentId) && (
        <View style={styles.addTop}>
          {adding ? (
            renderNewForm(false)
          ) : (
            <Pressable
              onPress={() => {
                setNewSubtaskParentId(null);
                setAdding(true);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.addRow, pressed && styles.dimmed]}
            >
              <Feather name="plus" size={16} color={colors.textMuted} />
              <Text style={styles.addRowText}>Добавить привычку</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Норма по уровням появляется, только если она поставлена: нули — это «уровни ничего
          не требуют», и карточка с тремя нулями значила бы ровно ничего. */}
      <LevelQuotaBoard
        dailyQuota={dailyQuota}
        dailyClosed={dailyClosed}
        weeklyQuota={levelRule.weekly}
        weeklyClosed={weeklyClosed}
        countMet={deciding.length > 0 && closed >= required}
      />

      {GROUPS.map((group) => {
        const inGroup = habits.filter((h) => habitGroup(h) === group.id && !h.parentId);
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

        const row = (h: Habit) => {
         const mySubtasks = habits.filter(sub => sub.parentId === h.id);
         // Кандидаты в родители — любые другие верхние привычки: подзадача у подзадачи не
         // рисуется, поэтому вложенность ровно в один уровень.
         const parentCandidates = habits.filter((p) => !p.parentId && p.id !== h.id);

         if (movingId === h.id) {
           return (
             <SubtaskParentPicker
               key={h.id}
               habit={h}
               candidates={parentCandidates}
               onPick={(parentId) => makeSubtask.mutate({ id: h.id, parentId })}
               onCancel={() => setMovingId(null)}
             />
           );
         }
  
         return editingId === h.id ? (
renderEditor(h.id, false)
          ) : (
            <HabitRow
              key={h.id}
              habit={h}
              group={group.id}
              editing={editing}
              editingId={editingId}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              saveEdit={saveEdit}
              setEditingId={setEditingId}
              standing={standings.get(h.id)!}
              markable={canMarkNow(h, lateRule, minutes)}
              count={logCount(logs.find((l) => l.habitId === h.id))}
              minimalDone={!!logs.find((l) => l.habitId === h.id)?.minimal}
              week={weeklyProgress(h, weekLogs, weekDates)}
              used={h.screen ? usedFor(h.screen) : null}
              onBump={(minimal) => handleBump(h, minimal)}
              onBumpSubtask={(sub) => handleBump(sub)}
              onEditSubtask={(sub) => startEdit(sub)}
              onResetSubtask={handleResetSubtask}
              subtasks={mySubtasks}
              logs={logs}
              expanded={expandedIds.includes(h.id)}
              setExpanded={(open) => setExpandedFor(h.id, open)}
              onAddSubtask={() => {
              setNewSubtaskParentId(h.id);
              setAdding(true);
              }}
              onEdit={() => startEdit(h)}
              onArchive={() => confirmArchive(h)}
              onReset={() => handleResetHabit(h)}
              renderEditor={(id) => renderEditor(id, true)}
              weekLogs={weekLogs}
              weekDates={weekDates}
              addForm={adding && newSubtaskParentId === h.id ? renderNewForm(true) : null}
              // Только та, у которой своих подзадач нет, и только если есть, куда её убрать.
              canMakeSubtask={mySubtasks.length === 0 && parentCandidates.length > 0}
              onMakeSubtask={() => {
                setEditingId(null);
                setAdding(false);
                setMovingId(h.id);
              }}
            />
          );
        };
        // «Ввожу сейчас» не сворачивается; остальные две по умолчанию закрыты.
        const collapsible = group.id !== "now";
        const groupOpen = !collapsible || openGroups.includes(group.id);

        return (
          <View key={group.id} style={[styles.group, collapsible && !groupOpen && styles.groupCollapsed]}>
            {collapsible ? (
              <Pressable
                onPress={() => toggleGroup(group.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: groupOpen }}
                accessibilityLabel={`${group.title}: ${inGroup.length}`}
                style={({ pressed }) => [styles.groupHeader, pressed && styles.dimmed]}
              >
                <Feather name={groupOpen ? "chevron-down" : "chevron-right"} size={15} color={colors.textMuted} />
                <Text style={styles.groupTitle}>{group.title}</Text>
                <Text style={styles.groupCount}>{inGroup.length}</Text>
              </Pressable>
            ) : (
              <Text style={styles.groupTitle}>{group.title}</Text>
            )}
            {groupOpen && (
              <>
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
              </>
            )}
          </View>
        );
      })}

    </ScrollView>
  );
}

/** One habit as it looks on an ordinary day. */
function HabitRow({
  habit,
  used,
  group,
  editing,
  standing,
  markable,
  count,
  minimalDone,
  week,
  onBump,
  onBumpSubtask,
  onEdit,
  onArchive,
  onReset,
  onEditSubtask,
  onResetSubtask,
  onAddSubtask,
  logs,
  subtasks,
  expanded,
  setExpanded,
  editingId,
  editDraft,
  setEditDraft,
  saveEdit,
  setEditingId,
  renderEditor,
  weekLogs,
  weekDates,
  addForm,
  canMakeSubtask,
  onMakeSubtask,
}: {
  habit: Habit;
  /** Сколько минут уже потрачено сегодня на то, за чем следит привычка. */
  used: number | null;
  group: ItemGroup;
  editing: boolean;
  /**
   * Where this habit stands — finished, owed today, not owed until later in the week, or
   * about to lose its run tonight. Decided by the list, which needs the same answer to know
   * where to put the row, and carrying the line printed under the name.
   */
  standing: HabitStanding;
  /**
   * False once the window has closed and the rule says a missed window costs the day. The
   * tap is refused rather than quietly not counting — a setting that accepts the tick and
   * then ignores it is a setting that does nothing.
   */
  markable: boolean;
  count: number;
  /** The day was closed with the small version — shown as a ring rather than a filled dot. */
  minimalDone: boolean;
  week: { count: number; target: number };
  onBumpSubtask: (sub: Habit) => void;
  onBump: (minimal?: boolean) => void;
  onEdit: () => void;
  onArchive: () => void;
  onEditSubtask: (sub: Habit) => void;
  onResetSubtask: (sub: Habit) => void;
  onReset: () => void;
  onAddSubtask: () => void;
  logs: HabitLog[];
  subtasks: Habit[];
  /** Раскрыт ли список подзадач. Живёт в экране, чтобы переезд строки между группами его не терял. */
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  editingId: string | null;
  editDraft: string;
  setEditDraft: (v: string) => void;
  saveEdit: () => void;
  setEditingId: (v: string | null) => void;
  renderEditor: (id: string) => ReactNode;
  /** Отметки за неделю и её дни — чтобы подзадача с недельной целью показала свой счёт. */
  weekLogs: HabitLog[];
  weekDates: string[];
  /** Форма новой подзадачи вместо кнопки «Добавить подзадачу». null — показывается кнопка. */
  addForm: ReactNode;
  /** Можно ли превратить эту привычку в подзадачу другой. */
  canMakeSubtask: boolean;
  onMakeSubtask: () => void;
}) {
  const target = habitTarget(habit);
  const hasSub = subtasks.length > 0;
  const doneCount = subtasks.filter(s => logs.find(l => l.habitId === s.id)?.done).length;
  const blockedBySubs = hasSub && doneCount < subtasks.length;
  const level = levelChoiceOf(habit);
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
          { flexDirection: "column", paddingHorizontal: 0, paddingVertical: 0 },
          
          closed && styles.cardChecked,
          urgent && styles.cardUrgent,
          parked && styles.cardParked,
          !tickable && styles.cardLater,
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 }}>
        <Pressable
          // Still tappable on a met week if today has no mark on it: a fourth run in a
          // week of three is a real thing that happened and should be recordable. What
          // stops a tap is today already being marked, which is the case where it would
          // do nothing.
          onPress={() => {
            if (!tickable || !markable || doneToday) return;
            if (blockedBySubs) {
              setExpanded(true);
              return;
            }
            onBump();
          }}
          disabled={!tickable || !markable || doneToday}
          accessibilityRole={perDay > 1 ? "button" : "checkbox"}
          accessibilityState={{ checked: closed, disabled: !tickable || !markable || doneToday || blockedBySubs }}
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
              {/* Значок перед названием и приглушённый: он помогает найти строку глазами, а
                  не спорит с текстом за внимание. */}
              {!!habit.icon && (
                <Feather name={habit.icon as IconName} size={13} color={colors.textMuted} />
              )}
              <Text style={[styles.label, { flexShrink: 1 }, !tickable && styles.labelLater]}>{habit.label}</Text>
              {habit.hasSubtasks && (
<View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', paddingLeft: 10 }}>
 {hasSub && (
    <>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginRight: 6 }}>
        {doneCount}/{subtasks.length}
      </Text>
      <View style={{ width: 36, height: 4, backgroundColor: colors.cardBorder, borderRadius: 2, marginRight: 8, overflow: 'hidden' }}>
        <View style={{ width: `${(doneCount / (subtasks.length || 1)) * 100}%`, height: '100%', backgroundColor: colors.accentGreen }} />
      </View>
    </>
  )}
    <Pressable onPress={() => setExpanded(!expanded)} style={{ padding: 2 }}>
      <Feather name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
    </Pressable>
  </View>
)}
              {/* Метка уровня стоит у названия, а не в конце строки: уровень — свойство самой
                  привычки, и читается он вместе с ней. Приглушённая заливка на то и нужна,
                  чтобы метка была видна, но не спорила с названием за взгляд. */}
              {hasLevel(level) && (
                <View style={[styles.levelTag, { backgroundColor: levelTint[level] }]}>
                  <Text style={[styles.levelTagText, { color: levelInk[level] }]}>{LEVEL_SHORT[level]}</Text>
                </View>
              )}
              {habit.auto === "screentime" && (
                <View style={styles.autoTag}>
                  <Feather name="smartphone" size={9} color={colors.textMuted} />
                  <Text style={styles.autoTagText}>Creker</Text>
                </View>
              )}
            </View>
            {!!habit.hint && <Text style={styles.hint}>{habit.hint}</Text>}
            {/* Экранная привычка отвечает числом, а не галочкой: галочка говорит «пока да»,
                а число — сколько именно и сколько ещё осталось. */}
            {habit.screen && <ScreenProgress rule={habit.screen} used={used} />}
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
            {canMakeSubtask && (
              <Pressable
                onPress={onMakeSubtask}
                style={styles.iconBtn}
                accessibilityLabel={`Сделать подзадачей: ${habit.label}`}
              >
                <Feather name="git-merge" size={14} color={colors.textMuted} />
              </Pressable>
            )}
            <Pressable onPress={onArchive} style={styles.iconBtn} accessibilityLabel={`Убрать в архив: ${habit.label}`}>
              <Feather name="archive" size={14} color={colors.textMuted} />
            </Pressable>
          </>
        )}
      </View>

      {/* Only where a minimal version was declared, and only while the full one is still
          open. Ticking it closes the day the small way — step 4 of the protocol. */}
      {tickable && markable && !!habit.minimal && !closed && (
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
{expanded && habit.hasSubtasks && (
  /* Подзадачи лежат на своей полупрозрачной подложке внутри карточки родителя: она читается
     как «внутри», а не как ещё одна карточка, и не перекрашивается вместе с родителем. */
  <View style={styles.subtaskPanel}>
      {subtasks.map(sub => {
        // Подзадача правится в полном редакторе, на месте своей строки
        if (editingId === sub.id) {
          return (
            <View key={sub.id}>
              {renderEditor(sub.id)}
            </View>
          );
        }
        const isDone = logs.find(l => l.habitId === sub.id)?.done ?? false;
        const canTick = tickable && markable && !isDone;
        // То же, что у привычки: уровень и «сколько раз». Своя цель у подзадачи есть — её
        // задают в том же редакторе, — но в строке она нигде не показывалась.
        const subLevel = levelChoiceOf(sub);
        const subTarget = habitTarget(sub);
        const subPerDay = perDayTarget(sub);
        const subCount = logCount(logs.find(l => l.habitId === sub.id));
        const subWeek = subTarget.kind === "weekly" ? weeklyProgress(sub, weekLogs, weekDates) : null;
        const subFreq = subWeek
          ? `${subWeek.count}/${subWeek.target} в неделю`
          : subPerDay > 1
            ? `${subCount}/${subPerDay} в день`
            : "1 раз в день";
        return (
          // Закрытая подзадача зеленеет целиком — как закрытая привычка: и подложка с рамкой,
          // и залитый кружок, и текст, а не один значок среди серого.
          <View key={sub.id} style={[styles.subtaskRow, isDone && styles.subtaskRowDone]}>
            <Pressable
              onPress={() => canTick && onBumpSubtask(sub)}
              disabled={!canTick}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isDone, disabled: !canTick }}
              accessibilityLabel={`${sub.label}: ${subFreq}`}
              style={styles.subtaskMain}
            >
              <View style={[styles.subtaskCheck, isDone && styles.subtaskCheckDone]}>
                {isDone ? (
                  <Feather name="check" size={12} color={colors.bg} />
                ) : subPerDay > 1 ? (
                  // Нужно несколько раз — в кружке счёт, как у привычки, иначе тап не отвечает ничем.
                  <Text style={styles.counterText}>{subCount}</Text>
                ) : null}
              </View>
              <Text style={[styles.subtaskLabel, isDone && styles.subtaskLabelDone]}>{sub.label}</Text>
              {/* Справа: метка уровня и сколько раз нужно — день, неделя. */}
              <View style={styles.subtaskMeta}>
                {hasLevel(subLevel) && (
                  <View style={[styles.levelTag, { backgroundColor: levelTint[subLevel] }]}>
                    <Text style={[styles.levelTagText, { color: levelInk[subLevel] }]}>{LEVEL_SHORT[subLevel]}</Text>
                  </View>
                )}
                <Text style={[styles.subtaskMetaText, isDone && styles.subtaskMetaTextDone]}>{subFreq}</Text>
              </View>
            </Pressable>

            {editing && (
              <>
                {isDone && (
                  <Pressable onPress={() => onResetSubtask(sub)} style={styles.iconBtn} accessibilityLabel={`Сбросить за сегодня: ${sub.label}`}>
                    <Feather name="rotate-ccw" size={14} color={colors.textMuted} />
                  </Pressable>
                )}
                <Pressable onPress={() => onEditSubtask(sub)} style={styles.iconBtn} accessibilityLabel={`Изменить: ${sub.label}`}>
                  <Feather name="edit-2" size={14} color={colors.textMuted} />
                </Pressable>
              </>
            )}
          </View>
        );
      })}

      {/* Подзадач нет и режим «Изменить» выключен: подсказка */}
      {!hasSub && !editing && (
        <Text style={styles.subtaskHint}>Нажми «Изменить», чтобы добавить подзадачу</Text>
      )}

      {/* Кнопка добавления только в режиме «Изменить». Своя рамка и отступы со всех сторон:
          голая строка с плюсом прилипала к краю карточки и к последней подзадаче. */}
      {addForm ?? (editing && (
        <Pressable
          onPress={onAddSubtask}
          accessibilityRole="button"
          accessibilityLabel={`Добавить подзадачу: ${habit.label}`}
          style={({ pressed }) => [styles.subtaskAdd, pressed && styles.dimmed]}
        >
          <Feather name="plus" size={16} color={colors.textMuted} />
          <Text style={styles.subtaskAddText}>Добавить подзадачу</Text>
        </Pressable>
      ))}
  </View>
)}
    </View>
    </View>
  );
}

/** The row turned into a form: name, the small version, which pile, and how often. */
/**
 * Сколько каждого уровня закрыто против того, сколько нужно.
 *
 * Две строки, и они про разное. Дневная норма решает сегодняшний день — без неё он не
 * закрыт, даже если по числу привычек всё сошлось. Недельная приговор дня не выносит: по
 * недельному числу нельзя сказать, закрыт ли вторник, а вся серия держится именно на этом.
 * Поэтому она стоит рядом как отдельная цель и ничего не рушит.
 */
function LevelQuotaBoard({
  dailyQuota,
  dailyClosed,
  weeklyQuota,
  weeklyClosed,
  countMet,
}: {
  dailyQuota: LevelQuota;
  dailyClosed: LevelQuota;
  weeklyQuota: LevelQuota;
  weeklyClosed: LevelQuota;
  /** Сошлось ли общее число привычек — вторая половина того же приговора. */
  countMet: boolean;
}) {
  const hasDaily = !quotaIsEmpty(dailyQuota);
  const hasWeekly = !quotaIsEmpty(weeklyQuota);
  if (!hasDaily && !hasWeekly) return null;

  const line = (quota: LevelQuota, closed: LevelQuota, title: string) => (
    <View style={styles.quotaLine}>
      <Text style={styles.quotaTitle}>{title}</Text>
      <View style={styles.quotaChips}>
        {LEVELS.filter((l) => quota[l] > 0).map((l) => {
          const met = closed[l] >= quota[l];
          return (
            <View key={l} style={[styles.quotaChip, { backgroundColor: levelTint[l] }]}>
              <Text style={[styles.quotaChipText, { color: levelInk[l] }]}>{LEVEL_SHORT[l]}</Text>
              <Text style={[styles.quotaChipCount, met && styles.quotaChipCountMet]}>
                {Math.min(closed[l], quota[l])}/{quota[l]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.quotaCard}>
      {hasDaily && line(dailyQuota, dailyClosed, "Сегодня нужно")}
      {hasWeekly && line(weeklyQuota, weeklyClosed, "За неделю")}
      {/* Ровно один случай, и он единственный, где строка нужна: по числу привычек всё
          сошлось, а по уровням нет. Шапка в этот момент говорит «закрыто 2 из 10 · нужно 2»,
          и без этой строки её можно прочесть как «день сделан». В остальное время
          чипы выше говорят всё сами, а постоянная строка стала бы обоями. */}
      {hasDaily && countMet && !meetsQuota(dailyClosed, dailyQuota) && (
        <Text style={styles.quotaNote}>
          По числу привычек день закрыт, но норма по уровням ещё не сошлась — значит, не
          закрыт.
        </Text>
      )}
    </View>
  );
}

/**
 * Куда убрать привычку, которая становится подзадачей.
 *
 * Отметки остаются при ней: они записаны под её id, а он не меняется, — история переезжает
 * вместе с привычкой, ничего не копируется. Меняется только то, где она живёт: из верхнего
 * списка внутрь родителя. Обратного хода здесь нет, поэтому выбор в два шага — иконка в
 * режиме правки, а потом этот список, где родителя называют прямо.
 *
 * Строки во всю ширину, а не чипы: названия привычек длинные, и чип длиннее строки
 * вылезает за край, а не переносится.
 */
function SubtaskParentPicker({
  habit,
  candidates,
  onPick,
  onCancel,
}: {
  habit: Habit;
  candidates: Habit[];
  onPick: (parentId: string) => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.editCard}>
      <View style={styles.editRow}>
        <Text style={[styles.label, { flex: 1 }]}>{`Сделать подзадачей: «${habit.label}»`}</Text>
        <Pressable onPress={onCancel} style={styles.iconBtn} accessibilityLabel="Отменить">
          <Feather name="x" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      <Text style={styles.editNote}>
        Выбери привычку, внутрь которой она переедет. Все отметки сохранятся — история останется как была.
      </Text>
      {GROUPS.map((g) => {
        const inGroup = candidates.filter((p) => habitGroup(p) === g.id);
        if (inGroup.length === 0) return null;
        return (
          <View key={g.id} style={{ gap: 6 }}>
            <Text style={styles.editLabel}>{g.title}</Text>
            {inGroup.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => onPick(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Внутрь: ${p.label}`}
                style={({ pressed }) => [styles.pickRow, pressed && styles.dimmed]}
              >
                <Feather name="corner-down-right" size={13} color={colors.textMuted} />
                <Text style={styles.pickRowText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function HabitEditor({
  label,
  onLabel,
  minimal,
  onMinimal,
  group,
  onGroup,
  level,
  onLevel,
  target,
  onTarget,
  schedule,
  onSchedule,
  screen,
  onScreen,
  apps,
  icon,
  onIcon,
  icons,
  onSave,
  onCancel,
  hasSubtasks,
  onHasSubtasks,
  isSubtask,
}: {
  label: string;
  onLabel: (v: string) => void;
  minimal: string;
  onMinimal: (v: string) => void;
  group: ItemGroup;
  onGroup: (v: ItemGroup) => void;
  level: LevelChoice;
  onLevel: (v: LevelChoice) => void;
  target: HabitTarget;
  onTarget: (v: HabitTarget) => void;
  /** null when the habit can be done whenever, which is the default and usually the answer. */
  schedule: HabitSchedule | null;
  onSchedule: (v: HabitSchedule | null) => void;
  /** null — привычка отмечается руками. Иначе за неё отвечает Creker. */
  screen: ScreenRule | null;
  onScreen: (v: ScreenRule | null) => void;
  /** Приложения, которыми человек пользовался за последний месяц, — из чего выбирать. */
  apps: { packageName: string; label: string }[];
  /** Выбранный значок и те, что доступны из купленных наборов. */
  icon: string | null;
  onIcon: (v: string | null) => void;
  icons: IconName[];
  onSave: () => void;
  onCancel: () => void;
  hasSubtasks: boolean;
  onHasSubtasks: (v: boolean) => void;
  isSubtask?: boolean;
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

      {/* Значок — сразу под названием: он про то же, что и название, и выбирают их вместе.
          Первая кнопка снимает значок: привычка без него ничем не хуже. */}
      <Text style={styles.editLabel}>Значок</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => onIcon(null)}
          accessibilityRole="radio"
          accessibilityState={{ selected: icon === null }}
          accessibilityLabel="Без значка"
          style={({ pressed }) => [styles.iconBox, icon === null && styles.iconBoxOn, pressed && styles.dimmed]}
        >
          <Feather name="slash" size={15} color={icon === null ? colors.accentGreen : colors.textMuted} />
        </Pressable>
        {icons.map((name) => (
          <Pressable
            key={name}
            onPress={() => onIcon(name)}
            accessibilityRole="radio"
            accessibilityState={{ selected: icon === name }}
            accessibilityLabel={`Значок ${name}`}
            style={({ pressed }) => [styles.iconBox, icon === name && styles.iconBoxOn, pressed && styles.dimmed]}
          >
            <Feather name={name} size={15} color={icon === name ? colors.accentGreen : colors.textMuted} />
          </Pressable>
        ))}
      </View>
      <Text style={styles.editHint}>Новые наборы значков — за ядра, в «Наградах».</Text>

      {/* У подзадачи «куда» нет: она живёт внутри родителя и едет туда же, куда он. */}
      {!isSubtask && (
        <>
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
        </>
      )}

      {/* Уровень — не про то, сколько времени это занимает, а про то, сколько стоит усилия.
          Нужен ради нормы: «каждый день одна сложная» — требование, которое общим числом
          привычек не выразить. Пока норма нулевая, уровень просто виден и ничего не решает. */}
      <Text style={styles.editLabel}>Уровень</Text>
      <View style={styles.chipRow}>
        {/* Первым стоит «Без уровня»: метки нет, в норму по уровням привычка не идёт. */}
        <Pressable
          onPress={() => onLevel(NO_LEVEL)}
          accessibilityRole="radio"
          accessibilityState={{ selected: level === NO_LEVEL }}
          style={({ pressed }) => [styles.chip, level === NO_LEVEL && styles.chipOn, pressed && styles.dimmed]}
        >
          <Text style={[styles.chipText, level === NO_LEVEL && styles.chipTextOn]}>Без уровня</Text>
        </Pressable>
        {LEVELS.map((l) => (
          <Pressable
            key={l}
            onPress={() => onLevel(l)}
            accessibilityRole="radio"
            accessibilityState={{ selected: level === l }}
            style={({ pressed }) => [styles.chip, level === l && styles.chipOn, pressed && styles.dimmed]}
          >
            <Text style={[styles.chipText, level === l && styles.chipTextOn]}>{LEVEL_LABELS[l]}</Text>
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

      <ScheduleFields target={target} schedule={schedule} onSchedule={onSchedule} />
      <ScreenFields screen={screen} onScreen={onScreen} apps={apps} />
      {!isSubtask && (
      <Pressable 
  onPress={() => onHasSubtasks(!hasSubtasks)} 
  style={[styles.editRow, { marginTop: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.cardBorder }]}
>
  <View style={[
    styles.checkbox, 
    hasSubtasks && styles.checkboxChecked,
    { marginTop: 0 }
  ]}>
    {hasSubtasks && <Feather name="check" size={12} color={colors.bg} />}
  </View>
  
  <View style={{ flex: 1, marginLeft: 8 }}>
    <Text style={styles.label}>Подзадачи</Text>
    <Text style={styles.hint}>Разбить на шаги</Text>
  </View>
</Pressable>
      )}
    </View>
  );
}

/**
 * Сколько уже набрано по экранной привычке — числом, а не галочкой.
 *
 * Галочка говорит «пока да», а число — сколько именно и сколько ещё. Превышенный лимит
 * тёплый — это «сюда внимание»; набранный минимум зелёный — это «готово».
 */
function ScreenProgress({ rule, used }: { rule: ScreenRule; used: number | null }) {
  const atLeast = ruleDirection(rule) === "atLeast";
  const bar = formatMinutes(rule.limitMin);
  if (used === null)
    return (
      <Text style={styles.progress}>
        {`Creker ещё не считал сегодня · ${atLeast ? "не меньше" : "не больше"} ${bar}`}
      </Text>
    );
  const over = !atLeast && used > rule.limitMin;
  const reached = atLeast && used >= rule.limitMin;
  return (
    <Text style={[styles.progress, over && styles.overLimit, reached && styles.reached]}>
      {`${formatMinutes(used)} из ${bar}${over ? " — превышено" : reached ? " — набрано" : ""}`}
    </Text>
  );
}

/**
 * «Не больше пяти часов в тиктоке» — привычка, которую отмечает не человек, а Creker.
 *
 * Смысл в том, что такую привычку честно отметить самому почти нельзя: никто не помнит,
 * сколько просидел, и в конце дня отмечается не факт, а самоощущение. Здесь же за неё
 * отвечает то, что считало без спроса и без жалости.
 *
 * Выключено по умолчанию и сложено: у большинства привычек с экраном нет ничего общего, а
 * форма, которая спрашивает про лимит, подталкивает его выдумать.
 */
function ScreenFields({
  screen,
  onScreen,
  apps,
}: {
  screen: ScreenRule | null;
  onScreen: (v: ScreenRule | null) => void;
  apps: { packageName: string; label: string }[];
}) {
  const on = screen !== null;
  const limit = screen?.limitMin ?? DEFAULT_SCREEN_HABIT_LIMIT_MIN;

  const direction = screen ? ruleDirection(screen) : "atMost";
  const pick = (app: string, label: string) => onScreen({ ...(screen as ScreenRule), app, label, limitMin: limit });
  // Шаг в полчаса, а до часа — по десять минут: лимит в «4 ч 17 мин» — ложная точность,
  // а «хотя бы 20 минут» полчасовым шагом не выставить вовсе.
  const step = (delta: number) => {
    const fine = limit < SCREEN_LIMIT_FINE_UNTIL_MIN || (limit === SCREEN_LIMIT_FINE_UNTIL_MIN && delta < 0);
    const size = fine ? SCREEN_LIMIT_FINE_STEP_MIN : SCREEN_LIMIT_STEP_MIN;
    onScreen({
      ...(screen as ScreenRule),
      limitMin: Math.min(MAX_SCREEN_HABIT_LIMIT_MIN, Math.max(SCREEN_LIMIT_FINE_STEP_MIN, limit + delta * size)),
    });
  };
  /**
   * Смена стороны меняет и планку на разумную для неё: «не больше двух часов» и «не меньше
   * двух часов» — разные просьбы, и та же цифра почти никогда не подходит обеим.
   */
  const turn = (next: ScreenDirection) =>
    onScreen({
      ...(screen as ScreenRule),
      direction: next === "atLeast" ? "atLeast" : undefined,
      limitMin: next === "atLeast" ? DEFAULT_SCREEN_HABIT_MINIMUM_MIN : DEFAULT_SCREEN_HABIT_LIMIT_MIN,
    });

  return (
    <>
      <Pressable
        onPress={() =>
          onScreen(on ? null : { app: TOTAL_APP, label: "Всё экранное время", limitMin: DEFAULT_SCREEN_HABIT_LIMIT_MIN })
        }
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        style={({ pressed }) => [styles.screenToggle, pressed && styles.dimmed]}
      >
        <Feather name={on ? "check-square" : "square"} size={14} color={on ? colors.accentGreen : colors.textMuted} />
        <Text style={[styles.editLabel, styles.screenToggleText, on && styles.screenToggleTextOn]}>
          Считать из Creker
        </Text>
      </Pressable>

      {on && (
        <>
          <Text style={styles.editHint}>
            {direction === "atMost"
              ? "Отмечается сама: уложился в лимит — день засчитан, превысил — нет."
              : "Отмечается сама, как только наберёшь нужное время. Не набрал — это видно только назавтра: пока день идёт, ещё не поздно."}{" "}
            Отметить руками всё равно можно, и рука главнее — свою отметку Creker не перебьёт.
          </Text>

          <Text style={styles.editLabel}>Как считать</Text>
          <View style={styles.chipRow}>
            {([
              ["atMost", "Не больше"],
              ["atLeast", "Не меньше"],
            ] as [ScreenDirection, string][]).map(([id, title]) => (
              <Pressable
                key={id}
                onPress={() => direction !== id && turn(id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: direction === id }}
                style={({ pressed }) => [styles.chip, direction === id && styles.chipOn, pressed && styles.dimmed]}
              >
                <Text style={[styles.chipText, direction === id && styles.chipTextOn]}>{title}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.editLabel}>За чем следить</Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => pick(TOTAL_APP, "Всё экранное время")}
              accessibilityRole="radio"
              accessibilityState={{ selected: isTotal(screen as ScreenRule) }}
              style={({ pressed }) => [
                styles.chip,
                isTotal(screen as ScreenRule) && styles.chipOn,
                pressed && styles.dimmed,
              ]}
            >
              <Text style={[styles.chipText, isTotal(screen as ScreenRule) && styles.chipTextOn]}>Всё время</Text>
            </Pressable>
            {apps.map((a) => {
              const chosen = screen?.app === a.packageName;
              return (
                <Pressable
                  key={a.packageName}
                  onPress={() => pick(a.packageName, a.label)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  style={({ pressed }) => [styles.chip, chosen && styles.chipOn, pressed && styles.dimmed]}
                >
                  <Text style={[styles.chipText, chosen && styles.chipTextOn]}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {apps.length === 0 && (
            <Text style={styles.editHint}>
              Приложений в списке нет: Creker ещё ничего не перенёс. Пока можно взять всё
              экранное время, а приложения появятся после первой синхронизации в «Creker».
            </Text>
          )}

          <Text style={styles.editLabel}>{direction === "atMost" ? "Не больше" : "Не меньше"}</Text>
          <View style={styles.stepRow}>
            <Pressable onPress={() => step(-1)} accessibilityLabel="Уменьшить лимит" style={styles.stepBtn}>
              <Feather name="minus" size={14} color={colors.textMuted} />
            </Pressable>
            <Text style={styles.limitValue}>{formatMinutes(limit)}</Text>
            <Pressable onPress={() => step(1)} accessibilityLabel="Увеличить лимит" style={styles.stepBtn}>
              <Feather name="plus" size={14} color={colors.textMuted} />
            </Pressable>
            <Text style={styles.editHint}>{`в день · ${screen?.label ?? "всё экранное время"}`}</Text>
          </View>
        </>
      )}
    </>
  );
}

function describeTarget(target: HabitTarget): string {
  return target.kind === "daily"
    ? `${target.count} ${plural(target.count, ["раз", "раза", "раз"])} в день`
    : `${target.count} ${plural(target.count, ["раз", "раза", "раз"])} в неделю`;
}



/**
 * When the habit is supposed to happen: a time or a window, and — for a weekly one — which
 * days.
 *
 * Off by default and folded away, because for most habits the honest answer is "whenever"
 * and a form that asks for an hour invites inventing one. What a missed window costs is not
 * here: that is one rule about all habits, and it lives in «Настройки админа».
 */
function ScheduleFields({
  target,
  schedule,
  onSchedule,
}: {
  target: HabitTarget;
  schedule: HabitSchedule | null;
  onSchedule: (v: HabitSchedule | null) => void;
}) {
  const on = schedule !== null;
  const from = schedule?.from;
  const to = schedule?.to;
  const days = schedule?.days ?? [];
  const weekly = target.kind === "weekly";

  const patch = (next: Partial<HabitSchedule>) => onSchedule(normalizeSchedule({ ...schedule, ...next }) ?? {});

  // Steps of 30 minutes: a habit set to 07:45 rather than 08:00 is a false precision, and a
  // wheel picker for it would be more control than the thing being controlled.
  const step = (field: "from" | "to", delta: number) => {
    const base = field === "from" ? (from ?? 8 * 60) : (to ?? (from ?? 8 * 60) + 60);
    const value = (base + delta * 30 + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    patch({ [field]: value } as Partial<HabitSchedule>);
  };

  const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

  return (
    <>
      <Text style={styles.editLabel}>Когда</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => onSchedule(on ? null : { from: 8 * 60 })}
          accessibilityRole="radio"
          accessibilityState={{ selected: !on }}
          style={({ pressed }) => [styles.chip, !on && styles.chipOn, pressed && styles.dimmed]}
        >
          <Text style={[styles.chipText, !on && styles.chipTextOn]}>В любое время</Text>
        </Pressable>
        <Pressable
          onPress={() => onSchedule(on ? { ...schedule, from: from ?? 8 * 60 } : { from: 8 * 60 })}
          accessibilityRole="radio"
          accessibilityState={{ selected: on }}
          style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.dimmed]}
        >
          <Text style={[styles.chipText, on && styles.chipTextOn]}>По времени</Text>
        </Pressable>
      </View>

      {on && (
        <>
          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>{to === undefined ? "До" : "С"}</Text>
            <TimeStepper
              value={from ?? 8 * 60}
              label={clock(from ?? 8 * 60)}
              onStep={(d) => step("from", d)}
              name={to === undefined ? "срок" : "начало"}
            />
          </View>

          {to === undefined ? (
            <Pressable
              onPress={() => patch({ to: (from ?? 8 * 60) + 60 })}
              accessibilityRole="button"
              style={({ pressed }) => [styles.chip, styles.chipWide, pressed && styles.dimmed]}
            >
              <Text style={styles.chipText}>Задать промежуток «от — до»</Text>
            </Pressable>
          ) : (
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>До</Text>
              <TimeStepper value={to} label={clock(to)} onStep={(d) => step("to", d)} name="конец" />
              <Pressable
                onPress={() => onSchedule({ ...schedule, to: undefined })}
                accessibilityRole="button"
                accessibilityLabel="Убрать промежуток"
                style={({ pressed }) => [styles.iconBtn, pressed && styles.dimmed]}
              >
                <Feather name="x" size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          )}
        </>
      )}

      {on && (
        <>
          <Text style={styles.editLabel}>Если не успеть</Text>
          <View style={styles.chipRow}>
            {([
              [undefined, "Как в настройках"],
              ["none", "Ничего"],
              ["fail", "День провален"],
            ] as const).map(([value, title]) => {
              const picked = (schedule?.late ?? undefined) === value;
              return (
                <Pressable
                  key={title}
                  onPress={() => onSchedule({ ...schedule, late: value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked }}
                  style={({ pressed }) => [styles.chip, picked && styles.chipOn, pressed && styles.dimmed]}
                >
                  <Text style={[styles.chipText, picked && styles.chipTextOn]}>{title}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* Days only for a weekly habit. A daily one is owed every day by definition, and
          letting days narrow that would be a second, contradictory way of saying how often. */}
      {weekly && (
        <>
          <Text style={styles.editLabel}>В какие дни</Text>
          <View style={styles.chipRow}>
            {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => {
              const picked = days.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => {
                    const next = picked ? days.filter((x) => x !== d) : [...days, d];
                    onSchedule(normalizeSchedule({ ...schedule, days: next }) ?? null);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: picked }}
                  style={({ pressed }) => [styles.dayChip, picked && styles.chipOn, pressed && styles.dimmed]}
                >
                  <Text style={[styles.chipText, picked && styles.chipTextOn]}>{DAY_LABELS[d]}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.editNote}>
        {describeSchedule(schedule, weekly)}
      </Text>
    </>
  );
}

const DAY_LABELS: Record<number, string> = { 1: "пн", 2: "вт", 3: "ср", 4: "чт", 5: "пт", 6: "сб", 7: "вс" };

function describeSchedule(schedule: HabitSchedule | null, weekly: boolean): string {
  const line = formatSchedule(schedule ?? undefined);
  if (!line) return weekly ? "В любой день и в любое время." : "В любое время дня.";
  const window = formatWindow(schedule ?? undefined);
  const deadline = schedule?.to === undefined && schedule?.from !== undefined;
  const when = deadline ? `Отметить нужно до ${window}` : "Отметить нужно внутри промежутка";
  const cost =
    schedule?.late === "fail"
      ? "Не успел — день провален, отметить уже нельзя."
      : schedule?.late === "none"
        ? "Не успел — ничего: отметить можно и позже."
        : "Что будет, если не успеть, берётся из «Настроек админа».";
  return `${line}. ${when}. ${cost}`;
}

/** −/+ by half an hour, the same stepper shape the rest of the app uses. */
function TimeStepper({
  value,
  label,
  onStep,
  name,
}: {
  value: number;
  label: string;
  onStep: (delta: number) => void;
  name: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onStep(-1)}
        accessibilityRole="button"
        accessibilityLabel={`Раньше: ${name}`}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
      >
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.timeValue}>{label}</Text>
      <Pressable
        onPress={() => onStep(1)}
        accessibilityRole="button"
        accessibilityLabel={`Позже: ${name}`}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.dimmed]}
      >
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  dayOffCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(143,184,154,0.12)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 12,
  },
  dayOffText: { color: colors.accentGreen, fontSize: 12, lineHeight: 17, flex: 1 },
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
  // Свёрнутые кучки стоят плотнее: от них видно только заголовок.
  groupCollapsed: { marginTop: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  groupCount: { color: colors.textMuted, fontSize: 11 },
  groupTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  groupBlurb: { color: colors.textMuted, fontSize: 11, marginTop: 2, marginBottom: 10 },
  subHeading: { color: colors.textMuted, fontSize: 11, marginBottom: 6 },
  doneToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  doneToggleText: { color: colors.accentGreen, fontSize: 12, fontWeight: "600" },
  groupEmpty: { color: colors.textMuted, fontSize: 12, fontStyle: "italic", marginBottom: 10 },

  habitBlock: { marginBottom: 10 },

  // Подзадачи: прозрачная подложка внутри карточки родителя. Отступ по бокам и снизу —
  // чтобы ни строки, ни кнопка добавления не липли к краю карточки.
  subtaskPanel: {
    alignSelf: "stretch",
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 8,
    gap: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  subtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  // Тот же зелёный, что у закрытой привычки (cardChecked).
  subtaskRowDone: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreenDark },
  subtaskMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  subtaskCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#4a5058",
    alignItems: "center",
    justifyContent: "center",
  },
  subtaskCheckDone: { backgroundColor: colors.accentGreen, borderWidth: 0 },
  subtaskLabel: { flex: 1, color: colors.text, fontSize: 15 },
  subtaskLabelDone: { color: colors.accentGreen, textDecorationLine: "line-through" },
  // Правый край строки подзадачи: метка уровня и «сколько раз».
  subtaskMeta: { alignItems: "flex-end", gap: 3, marginLeft: 8 },
  subtaskMetaText: { color: colors.textMuted, fontSize: 10 },
  subtaskMetaTextDone: { color: colors.accentGreen },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  pickRowText: { flex: 1, color: colors.text, fontSize: 14 },
  subtaskHint: { color: colors.textMuted, fontSize: 14, paddingHorizontal: 10, paddingVertical: 6 },
  subtaskAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderStyle: "dashed",
  },
  subtaskAddText: { color: colors.textMuted, fontSize: 14, fontWeight: "500" },
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
  quotaCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  quotaLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  quotaTitle: { color: colors.textMuted, fontSize: 11 },
  quotaChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  quotaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  quotaChipText: { fontSize: 10, fontWeight: "600" },
  quotaChipCount: { color: colors.text, fontSize: 11, fontWeight: "700" },
  quotaChipCountMet: { color: colors.accentGreen },
  quotaNote: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  levelTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  levelTagText: { fontSize: 9, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chipWide: { alignSelf: "flex-start" },
  dayChip: {
    minWidth: 34,
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  // Экранная привычка: переключатель, подсказка и шаг лимита.
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  iconBoxOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  screenToggle: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingVertical: 4 },
  screenToggleText: { marginTop: 0 },
  screenToggleTextOn: { color: colors.accentGreen, fontWeight: "600" },
  editHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4, flexShrink: 1 },
  // Тёплый — «сюда внимание», и превышенный лимит ровно такой случай.
  overLimit: { color: colors.accent },
  reached: { color: colors.accentGreen },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  // Своя ширина, а не общая от счётчика раз: «2 ч 30 мин» в восемнадцать точек не влезает.
  limitValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 78,
    textAlign: "center",
  },
  timeLabel: { color: colors.textMuted, fontSize: 12, minWidth: 20 },
  timeValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 56,
    textAlign: "center",
  },
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
  // Кнопка стоит наверху, под шапкой; отступ снизу отделяет её от нормы по уровням.
  addTop: { marginTop: 12, marginBottom: 2 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderStyle: "dashed",
  },
  addRowText: { color: colors.textMuted, fontSize: 14 },
});
