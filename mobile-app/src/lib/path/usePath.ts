import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { todayKey, shiftDate } from "../date";
import { countedDates } from "../streak";
import { streakSummary, totalFocusMinutes, type StreakSummary } from "../stats";
import { goalProgress, hasContent, summaryWritten } from "../goals";
import { decideScreenTimeHabit } from "../screenTime";
import { PHASE_STEPS, type PhaseStep } from "../phase";
import { DEFAULT_DAY_RULE, type DayRule } from "../dayRule";
import { DEFAULT_DAY_OFF, type DayOffRule } from "../dayOff";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "../level";
import { earnedTitles, nextTitle, type EarnedTitle, type TitleRule, type TitleState } from "../rewards/catalog";
import { yearGrid, daysSince, type YearGrid } from "./year";
import type { ScreenDay } from "../screen/usage";
import type { FoodEntry } from "../balance/food";
import type { WeightEntry } from "../balance/weight";
import type { GameStats } from "../games/stats";
import type { PeriodGoal } from "../goals";
import type { FocusSession, Habit, HabitLog } from "../../types";

/**
 * «Путь» — всё, что было, в одном месте.
 *
 * Разделы отвечают про сегодня и про месяц, и это правильно: приложение открывают, чтобы
 * закрыть день, а не чтобы любоваться прошлым. Но прошлое при этом оказалось размазано —
 * серия в одном разделе, закрытые дни во втором, итоги в третьем, поля в четвёртом, — и
 * целиком его не видно нигде.
 *
 * Здесь ничего не начисляется и не пишется: экран только читает. Начисление живёт в
 * «Наградах» и остаётся в одном месте, иначе два экрана считали бы одно и то же от разных
 * снимков состояния.
 */

/** Насколько далеко смотреть назад. Больше года: «за всё время» должно значить всё время. */
const WINDOW_DAYS = 1200;

export interface PathView {
  ready: boolean;
  /** Первая отметка вообще. `null` — истории ещё нет. */
  since: string | null;
  /** Сколько дней прошло с неё, считая её саму. */
  days: number;
  closedDays: number;
  streak: StreakSummary;
  grid: YearGrid;
  /** Этапы дороги и то, докуда дошёл. */
  phases: { step: PhaseStep; reached: boolean }[];
  focus: { sessions: number; minutes: number };
  goals: { planned: number; summaries: number; done: number };
  /** CaloriX и Creker: дни с записанной едой, записи веса, дни в пределах экранного лимита. */
  care: { mealDays: number; weights: number; screenDays: number };
  games: { fields: number; hard: number; records: number };
  titles: EarnedTitle[];
  next: { rule: TitleRule; have: number; need: number } | null;
}

export function usePath(): PathView {
  const today = todayKey();
  const from = shiftDate(today, -WINDOW_DAYS);

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: logs, isPending: logsPending } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "path", from, today],
    queryFn: () => api.getHabitLog(from, today) as Promise<HabitLog[]>,
  });
  const { data: sessions = [] } = useQuery<FocusSession[]>({
    queryKey: ["sessions", "path", from, today],
    queryFn: () => api.getSessions(from, today) as Promise<FocusSession[]>,
  });
  const { data: freezes = [] } = useQuery<string[]>({ queryKey: ["freezes"], queryFn: () => api.getFreezes() });
  const { data: goals = [] } = useQuery<PeriodGoal[]>({ queryKey: ["goals"], queryFn: () => api.getGoals() });
  const { data: games } = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });
  const { data: dayRule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });
  const { data: levelRule = DEFAULT_LEVEL_RULE } = useQuery<LevelRule>({
    queryKey: ["levelRule"],
    queryFn: () => api.getLevelRule(),
  });
  const { data: daysOff = DEFAULT_DAY_OFF } = useQuery<DayOffRule>({
    queryKey: ["daysOff"],
    queryFn: () => api.getDaysOff(),
  });
  const { data: meals = [] } = useQuery<FoodEntry[]>({
    queryKey: ["foodLog", "path", from, today],
    queryFn: () => api.getFoodLog(from, today),
  });
  const { data: weights = [] } = useQuery<WeightEntry[]>({
    queryKey: ["weightLog"],
    queryFn: () => api.getWeightLog(),
  });
  const { data: screenDays = [] } = useQuery<ScreenDay[]>({
    queryKey: ["screenDays", "path", from, today],
    queryFn: () => api.getScreenDays(from, today),
  });
  const { data: screenLimit = 0 } = useQuery<number>({
    queryKey: ["screenTimeLimit"],
    queryFn: () => api.getScreenTimeLimitMinutes(),
  });

  const log = logs ?? [];
  const counted = countedDates(habits, log, dayRule, levelRule);
  const streak = streakSummary(counted, freezes, from, today, daysOff);

  /*
   * Начало пути — первая отметка, а не первая закрытая дата.
   *
   * День мог не закрыться, а человек в нём уже был: отметил две привычки из пяти и лёг
   * спать. Считать началом первый удавшийся день значило бы вычеркнуть первую неделю ровно
   * у тех, у кого она не задалась, — а это и есть те, кому «сколько я уже здесь» нужнее
   * всего.
   */
  const since = log.length === 0 ? null : log.reduce((min, l) => (l.date < min ? l.date : min), log[0].date);

  const mealDays = new Set(meals.map((m) => m.date)).size;
  const screenOk = screenDays.filter((d) => {
    const verdict = decideScreenTimeHabit(d, screenLimit, Date.now(), d.date);
    return verdict.action === "tick" && verdict.withinLimit;
  }).length;
  const focusMinutes = totalFocusMinutes(sessions);

  const monthGoals = goals.filter((g) => g.kind === "month" && hasContent(g));
  const titleState: TitleState = {
    bestStreak: streak.best,
    closedDays: counted.size,
    summaries: monthGoals.filter((g) => summaryWritten(g)).length,
    goalsDone: monthGoals.filter((g) => {
      const p = goalProgress(g);
      return p.total > 0 && p.done === p.total;
    }).length,
    fields: games?.wordsearch.solved ?? 0,
    hardFields: games?.wordsearch.byDifficulty.hard ?? 0,
    mealDays,
    weights: weights.length,
    screenDays: screenOk,
    focusMinutes,
  };

  return {
    ready: !logsPending && games !== undefined,
    since,
    days: daysSince(since, today),
    closedDays: counted.size,
    streak,
    grid: yearGrid({ today, closed: counted, frozen: new Set(freezes), daysOff, since }),
    // Этап засчитан по лучшей серии, а не по текущей: дойти до «спада» и сорваться — это
    // всё равно дойти. Отбирать пройденное за то, что было потом, — переписывание истории.
    phases: PHASE_STEPS.map((step) => ({ step, reached: streak.best >= step.fromDay })),
    focus: { sessions: sessions.length, minutes: focusMinutes },
    goals: { planned: monthGoals.length, summaries: titleState.summaries, done: titleState.goalsDone },
    care: { mealDays, weights: weights.length, screenDays: screenOk },
    games: {
      fields: titleState.fields,
      hard: titleState.hardFields,
      records: Object.keys(games?.wordsearch.best ?? {}).length,
    },
    titles: earnedTitles(titleState),
    next: nextTitle(titleState),
  };
}
