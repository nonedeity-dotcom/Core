import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { todayKey } from "../date";
import { countedDates } from "../streak";
import { streakSummary } from "../stats";
import { goalProgress, hasContent, summaryWritten } from "../goals";
import { DEFAULT_DAY_RULE, type DayRule } from "../dayRule";
import { DEFAULT_DAY_OFF, type DayOffRule } from "../dayOff";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "../level";
import { applyAwards, type Purse } from "./currency";
import { earnedAwards, type EarnState } from "./earn";
import { earnedTitles, type EarnedTitle, type TitleState } from "./catalog";
import type { GameStats } from "../games/stats";
import type { PeriodGoal } from "../goals";
import type { FocusSession, Habit, HabitLog } from "../../types";

/**
 * Начисление — в одном месте и от состояния, а не от событий.
 *
 * Соблазн был начислять прямо там, где что-то происходит: отметил привычку — получил искры.
 * Так не вышло бы главного: начисления за прошлое и защиты от двойной оплаты. Пришлось бы
 * ловить каждое место, где день может закрыться, и в каждом помнить, платили уже или нет.
 *
 * Здесь наоборот: состояние читается целиком, из него выводится всё, что причитается, и
 * кошелёк отсеивает оплаченное по ключам. Один проход отвечает сразу на всё — и на «что
 * нового», и на «а что там было за полгода до магазина».
 */

/** Сколько истории читать. Тот же горизонт, на котором живут серии. */
const WINDOW_DAYS = 400;

export interface RewardsView {
  purse: Purse | undefined;
  titles: EarnedTitle[];
  /** Сколько закрытых дней за всё время — для титулов и для «Пути». */
  closedDays: number;
}

export function useRewards(): RewardsView {
  const qc = useQueryClient();
  const today = todayKey();
  const from = shiftBack(today, WINDOW_DAYS);

  const { data: purse } = useQuery<Purse>({ queryKey: ["purse"], queryFn: () => api.getPurse() });
  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: ["habitLog", "rewards", from, today],
    queryFn: () => api.getHabitLog(from, today) as Promise<HabitLog[]>,
  });
  const { data: sessions = [] } = useQuery<FocusSession[]>({
    queryKey: ["sessions", "rewards", from, today],
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

  const counted = countedDates(habits, logs, dayRule, levelRule);
  const streaks = streakSummary(counted, freezes, from, today, daysOff);

  const sessionsByDate: Record<string, number> = {};
  for (const s of sessions) sessionsByDate[s.date] = (sessionsByDate[s.date] ?? 0) + 1;

  const monthGoals = goals.filter((g) => g.kind === "month");
  const state: EarnState = {
    countedDates: [...counted].sort(),
    today,
    bestStreak: streaks.best,
    sessionsByDate,
    summaries: monthGoals.filter((g) => summaryWritten(g)).map((g) => g.period),
    goalsDone: monthGoals
      .filter((g) => {
        const p = goalProgress(g);
        return hasContent(g) && p.total > 0 && p.done === p.total;
      })
      .map((g) => g.period),
    fields: games?.wordsearch.byDifficulty ?? { easy: 0, normal: 0, hard: 0 },
    records: Object.keys(games?.wordsearch.best ?? {}),
  };

  /*
   * Запись идёт один раз на набор данных.
   *
   * Без этой отсечки получался замкнутый круг: запись помечает кошелёк устаревшим, он
   * перечитывается, пересчёт запускается снова. Ключи бы его остановили — платить было бы не
   * за что, — но приложение крутило бы эту карусель на каждом кадре.
   */
  const writing = useRef<string | null>(null);
  const ready = purse !== undefined && games !== undefined;
  useEffect(() => {
    if (!ready) return;
    const awards = earnedAwards(state);
    const fresh = awards.filter((a) => !purse.paid.includes(a.key));
    if (fresh.length === 0) return;
    const stamp = fresh.map((a) => a.key).join("|");
    if (writing.current === stamp) return;
    writing.current = stamp;
    void api.setPurse(applyAwards(purse, fresh, today)).then(() => {
      qc.invalidateQueries({ queryKey: ["purse"] });
    });
  });

  const titleState: TitleState = {
    bestStreak: streaks.best,
    closedDays: counted.size,
    summaries: state.summaries.length,
    goalsDone: state.goalsDone.length,
    fields: games?.wordsearch.solved ?? 0,
    hardFields: games?.wordsearch.byDifficulty.hard ?? 0,
  };

  return { purse, titles: earnedTitles(titleState), closedDays: counted.size };
}

/** Дата на N дней назад — без зависимости от «сегодня» из другого модуля. */
function shiftBack(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const cursor = new Date(y, m - 1, d, 12);
  cursor.setDate(cursor.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`;
}
