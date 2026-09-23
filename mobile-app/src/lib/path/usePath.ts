import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { todayKey, shiftDate } from "../date";
import { countedDates } from "../streak";
import { streakSummary, totalFocusMinutes, type StreakSummary } from "../stats";
import { goalProgress, hasContent, summaryWritten } from "../goals";
import { PHASE_STEPS, type PhaseStep } from "../phase";
import { DEFAULT_DAY_RULE, type DayRule } from "../dayRule";
import { DEFAULT_DAY_OFF, type DayOffRule } from "../dayOff";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "../level";
import { HISTORY_WINDOW_DAYS, historyKeys } from "../rewards/useRewards";
import { screenHabitDates } from "../rewards/ledger";
import { yearGrid, daysSince, type YearGrid } from "./year";
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
 * Здесь ничего не начисляется и не пишется: экран только читает. Титулы тоже не свои — их
 * даёт начисление, по журналу рассчитанных дней; «Путь» показывает то, что было, по
 * нынешним правилам.
 *
 * История читается тем же окном и теми же ключами, что и у начисления: оба живут в
 * «Профиле», и раньше одна и та же история грузилась дважды — на 400 дней и на 1200.
 */

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
  games: { fields: number; hard: number; records: number; wheel: number };
}

export function usePath(): PathView {
  const today = todayKey();
  const from = shiftDate(today, -HISTORY_WINDOW_DAYS);
  const keys = historyKeys(from, today);

  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: logs, isPending: logsPending } = useQuery<HabitLog[]>({
    queryKey: keys.logs,
    queryFn: () => api.getHabitLog(from, today) as Promise<HabitLog[]>,
  });
  const { data: sessions = [] } = useQuery<FocusSession[]>({
    queryKey: keys.sessions,
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
    queryKey: keys.meals,
    queryFn: () => api.getFoodLog(from, today),
  });
  const { data: weights = [] } = useQuery<WeightEntry[]>({
    queryKey: ["weightLog"],
    queryFn: () => api.getWeightLog(),
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
  // Та же мера, что у начисления: день, когда все экранные привычки удержались.
  const screenOk = screenHabitDates(habits, log).size;
  const focusMinutes = totalFocusMinutes(sessions);

  const monthGoals = goals.filter((g) => g.kind === "month" && hasContent(g));
  const summaries = monthGoals.filter((g) => summaryWritten(g)).length;
  const goalsDone = monthGoals.filter((g) => {
    const p = goalProgress(g);
    return p.total > 0 && p.done === p.total;
  }).length;

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
    goals: { planned: monthGoals.length, summaries, done: goalsDone },
    care: { mealDays, weights: weights.length, screenDays: screenOk },
    games: {
      fields: games?.wordsearch.solved ?? 0,
      hard: games?.wordsearch.byDifficulty.hard ?? 0,
      records: Object.keys(games?.wordsearch.best ?? {}).length,
      wheel: games?.wheel.level ?? 0,
    },
  };
}
