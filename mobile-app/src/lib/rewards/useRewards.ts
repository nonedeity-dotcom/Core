import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { shiftDate, todayKey } from "../date";
import { countedDates } from "../streak";
import { streakSummary, totalFocusMinutes } from "../stats";
import { goalProgress, hasContent, summaryWritten } from "../goals";
import { DEFAULT_DAY_RULE, type DayRule } from "../dayRule";
import { DEFAULT_DAY_OFF, type DayOffRule } from "../dayOff";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "../level";
import { applyAwards, type Purse } from "./currency";
import { earnedAwards, type EarnState } from "./earn";
import { earnedTitles, nextTitle, type EarnedTitle, type TitleRule, type TitleState } from "./catalog";
import {
  earliest,
  effective,
  paidDates,
  restDays,
  screenHabitDates,
  settle,
  type Ledger,
  type Verdicts,
} from "./ledger";
import type { FoodEntry } from "../balance/food";
import type { WeightEntry } from "../balance/weight";
import type { GameStats } from "../games/stats";
import type { PeriodGoal } from "../goals";
import type { FocusSession, Habit, HabitLog } from "../../types";

/**
 * Начисление — в одном месте и от состояния, а не от событий.
 *
 * Состояние читается целиком, из него выводится всё, что причитается, и кошелёк отсеивает
 * оплаченное по ключам. Один проход отвечает и на «что нового», и на «что там было за
 * полгода до магазина».
 *
 * Поверх этого — журнал рассчитанных дней (ledger.ts). Без него «от состояния» означало
 * «по нынешним правилам», и смена правила переписывала прошлое: понизил планку — старые дни
 * стали закрытыми и оплатились. Теперь прошедший день решается один раз и записывается, а
 * нынешние правила судят только то, что ещё не закончилось.
 */

/**
 * Сколько истории читать.
 *
 * Столько же, сколько «Путь», и теми же ключами запросов: оба живут в «Профиле», и два
 * разных окна означали две загрузки одной и той же истории и два разных «за всё время» на
 * соседних вкладках. После первого расчёта окно нужно только для открытых дней — всё
 * старое уже в журнале, — но первый расчёт должен увидеть всё, что есть.
 */
export const HISTORY_WINDOW_DAYS = 1200;

/** Ключи запросов за всю историю — общие с «Путём», чтобы история грузилась один раз. */
export const historyKeys = (from: string, today: string) => ({
  logs: ["habitLog", "all", from, today],
  sessions: ["sessions", "all", from, today],
  meals: ["foodLog", "all", from, today],
});

export interface RewardsView {
  purse: Purse | undefined;
  titles: EarnedTitle[];
  titleState: TitleState;
  next: { rule: TitleRule; have: number; need: number } | null;
}

export function useRewards(): RewardsView {
  const qc = useQueryClient();
  const today = todayKey();
  const from = shiftDate(today, -HISTORY_WINDOW_DAYS);
  const keys = historyKeys(from, today);

  const purseQ = useQuery<Purse>({ queryKey: ["purse"], queryFn: () => api.getPurse() });
  const habitsQ = useQuery<Habit[]>({ queryKey: ["habits"], queryFn: () => api.getHabits() as Promise<Habit[]> });
  const logsQ = useQuery<HabitLog[]>({
    queryKey: keys.logs,
    queryFn: () => api.getHabitLog(from, today) as Promise<HabitLog[]>,
  });
  const sessionsQ = useQuery<FocusSession[]>({
    queryKey: keys.sessions,
    queryFn: () => api.getSessions(from, today) as Promise<FocusSession[]>,
  });
  const freezesQ = useQuery<string[]>({ queryKey: ["freezes"], queryFn: () => api.getFreezes() });
  const goalsQ = useQuery<PeriodGoal[]>({ queryKey: ["goals"], queryFn: () => api.getGoals() });
  const gamesQ = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });
  const dayRuleQ = useQuery<DayRule>({ queryKey: ["dayRule"], queryFn: () => api.getDayRule() });
  const levelRuleQ = useQuery<LevelRule>({ queryKey: ["levelRule"], queryFn: () => api.getLevelRule() });
  const daysOffQ = useQuery<DayOffRule>({ queryKey: ["daysOff"], queryFn: () => api.getDaysOff() });
  const mealsQ = useQuery<FoodEntry[]>({ queryKey: keys.meals, queryFn: () => api.getFoodLog(from, today) });
  const weightsQ = useQuery<WeightEntry[]>({ queryKey: ["weightLog"], queryFn: () => api.getWeightLog() });

  /*
   * Считать можно только когда пришло всё.
   *
   * Раньше хватало кошелька и игр, а остальное подставлялось пустым. Для начислений это
   * было безвредно — пустое ничего не оплачивает. Для журнала это катастрофа: расчёт по
   * ещё не загруженной истории записал бы прошлое пустым, и навсегда.
   */
  const ready = [
    purseQ,
    habitsQ,
    logsQ,
    sessionsQ,
    freezesQ,
    goalsQ,
    gamesQ,
    dayRuleQ,
    levelRuleQ,
    daysOffQ,
    mealsQ,
    weightsQ,
  ].every((q) => q.isSuccess);

  const purse = purseQ.data;
  const habits = habitsQ.data ?? [];
  const logs = logsQ.data ?? [];
  const sessions = sessionsQ.data ?? [];
  const freezes = freezesQ.data ?? [];
  const goals = goalsQ.data ?? [];
  const games = gamesQ.data;
  const dayRule = dayRuleQ.data ?? DEFAULT_DAY_RULE;
  const levelRule = levelRuleQ.data ?? DEFAULT_LEVEL_RULE;
  const daysOff = daysOffQ.data ?? DEFAULT_DAY_OFF;
  const meals = mealsQ.data ?? [];
  const weights = weightsQ.data ?? [];

  const counted = countedDates(habits, logs, dayRule, levelRule);
  const verdicts: Verdicts = {
    from,
    closed: counted,
    rest: restDays(counted, freezes, daysOff, from, today),
    screen: screenHabitDates(habits, logs),
  };

  const sessionsByDate: Record<string, number> = {};
  for (const s of sessions) sessionsByDate[s.date] = (sessionsByDate[s.date] ?? 0) + 1;

  const monthGoals = goals.filter((g) => g.kind === "month");
  const summaries = monthGoals.filter((g) => summaryWritten(g)).map((g) => g.period);
  const goalsDone = monthGoals
    .filter((g) => {
      const p = goalProgress(g);
      return hasContent(g) && p.total > 0 && p.done === p.total;
    })
    .map((g) => g.period);
  const mealDates = [...new Set(meals.map((m) => m.date))];

  /** Всё, что причитается, при данном журнале. Чистая функция — её зовут и здесь, и под блокировкой. */
  const stateFor = (ledger: Ledger): EarnState => {
    const all = effective(ledger, verdicts);
    const streak = streakSummary(all.closed, [...all.rest], earliest(ledger, verdicts), today, DEFAULT_DAY_OFF);
    return {
      countedDates: [...all.closed].sort(),
      today,
      bestStreak: streak.best,
      sessionsByDate,
      summaries,
      goalsDone,
      fields: games?.wordsearch.byDifficulty ?? { easy: 0, normal: 0, hard: 0 },
      records: Object.keys(games?.wordsearch.best ?? {}),
      mealDates,
      weightDates: weights.map((w) => w.date),
      screenDates: [...all.screen].sort(),
    };
  };

  const seedFor = (p: Purse) => ({ closed: paidDates(p.paid, "day"), screen: paidDates(p.paid, "screen") });
  const ledger = purse && ready ? settle(purse.ledger, verdicts, today, seedFor(purse)) : purse?.ledger;
  const state = ledger ? stateFor(ledger) : null;

  /*
   * Запись — одна на набор изменений.
   *
   * Без отсечки получался бы круг: запись обновляет кошелёк, он перечитывается, пересчёт
   * запускается снова. Ключи бы его остановили, но приложение крутило бы карусель на
   * каждом кадре.
   *
   * Сама запись идёт правкой под блокировкой, а не готовым кошельком: всё пересчитывается
   * от того, что лежит в хранилище в эту секунду. Иначе начисление, дописанное после
   * покупки, откатывало бы покупку — оно собиралось из копии, в которой её ещё не было.
   */
  const writing = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !purse || !ledger || !state) return;
    const fresh = earnedAwards(state).filter((a) => !purse.paid.includes(a.key));
    const moved = ledger.through !== purse.ledger.through;
    if (!moved && fresh.length === 0) return;
    const stamp = `${ledger.through}|${fresh.map((a) => a.key).join("|")}`;
    if (writing.current === stamp) return;
    writing.current = stamp;
    void api
      .updatePurse((current) => {
        const settled = settle(current.ledger, verdicts, today, seedFor(current));
        return applyAwards({ ...current, ledger: settled }, earnedAwards(stateFor(settled)), today);
      })
      .then((saved) => {
        if (saved) qc.setQueryData(["purse"], saved);
      });
  });

  const titleState: TitleState = {
    bestStreak: state?.bestStreak ?? 0,
    closedDays: state?.countedDates.length ?? 0,
    summaries: summaries.length,
    goalsDone: goalsDone.length,
    fields: games?.wordsearch.solved ?? 0,
    hardFields: games?.wordsearch.byDifficulty.hard ?? 0,
    mealDays: mealDates.length,
    weights: weights.length,
    screenDays: state?.screenDates.length ?? 0,
    focusMinutes: totalFocusMinutes(sessions),
  };

  return { purse, titles: earnedTitles(titleState), titleState, next: nextTitle(titleState) };
}
