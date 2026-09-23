import type { Difficulty } from "./wordsearch";

/**
 * Что игра про себя помнит.
 *
 * Немного и намеренно: сколько полей решено и лучшее время по каждой паре «тема —
 * сложность». Ни очков, ни уровней, ни валюты — это игра на перерыв, а не вторая жизнь с
 * прогрессом, который жалко бросить.
 *
 * Со временем играют не всегда, поэтому рекорд есть не у каждой пары: поле, решённое без
 * секундомера, засчитывается в «решено», но ничьего рекорда не трогает — сравнивать его не
 * с чем.
 */
export interface WordSearchStats {
  /** Сколько полей собрано до конца. */
  solved: number;
  /**
   * Сколько из них по каждой сложности.
   *
   * Общего счёта не хватило, когда за поля стали начислять монеты: поле 12×12 стоит вчетверо
   * дороже восьмёрки, а по одному числу их не различить.
   */
  byDifficulty: Record<Difficulty, number>;
  /** Лучшее время в секундах по ключу «тема:сложность». */
  best: Record<string, number>;
  /** Дата последней игры, "yyyy-MM-dd" — для строки на Главной. */
  lastAt: string;
}

export interface GameStats {
  wordsearch: WordSearchStats;
}

const emptyByDifficulty = (): Record<Difficulty, number> => ({ easy: 0, normal: 0, hard: 0 });

export const EMPTY_WORD_SEARCH: WordSearchStats = {
  solved: 0,
  byDifficulty: emptyByDifficulty(),
  best: {},
  lastAt: "",
};
export const emptyWordSearch = (): WordSearchStats => ({
  solved: 0,
  byDifficulty: emptyByDifficulty(),
  best: {},
  lastAt: "",
});
export const DEFAULT_GAME_STATS: GameStats = { wordsearch: emptyWordSearch() };

/** Ключ рекорда. Тема и сложность вместе: одно поле 12×12 не сравнивают с полем 8×8. */
export const recordKey = (themeId: string, difficulty: Difficulty): string => `${themeId}:${difficulty}`;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export function normalizeGameStats(raw: unknown): GameStats {
  if (typeof raw !== "object" || raw === null) return { wordsearch: emptyWordSearch() };
  const o = (raw as Record<string, unknown>).wordsearch;
  if (typeof o !== "object" || o === null) return { wordsearch: emptyWordSearch() };
  const w = o as Record<string, unknown>;
  const best: Record<string, number> = {};
  if (typeof w.best === "object" && w.best !== null) {
    for (const [key, value] of Object.entries(w.best as Record<string, unknown>)) {
      const seconds = num(value);
      // Ноль секунд — это не рекорд, а сбой: поле нельзя собрать мгновенно.
      if (seconds > 0) best[key] = seconds;
    }
  }
  const counts = (typeof w.byDifficulty === "object" && w.byDifficulty !== null
    ? w.byDifficulty
    : {}) as Record<string, unknown>;
  const byDifficulty: Record<Difficulty, number> = {
    easy: num(counts.easy),
    normal: num(counts.normal),
    hard: num(counts.hard),
  };
  return {
    wordsearch: {
      solved: num(w.solved),
      byDifficulty,
      best,
      lastAt: typeof w.lastAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w.lastAt) ? w.lastAt : "",
    },
  };
}

/**
 * Слияние игровой статистики с другого телефона.
 *
 * Счётчики берутся большие, а не складываются: если обе копии собраны из одних и тех же
 * партий, сумма удвоила бы поля — и монеты за них. Рекорд — лучший из двух, то есть
 * меньшее время.
 */
export function mergeGameStats(a: GameStats, b: GameStats): GameStats {
  const best: Record<string, number> = { ...a.wordsearch.best };
  for (const [key, seconds] of Object.entries(b.wordsearch.best)) {
    best[key] = best[key] === undefined ? seconds : Math.min(best[key], seconds);
  }
  const by = (d: Difficulty) => Math.max(a.wordsearch.byDifficulty[d], b.wordsearch.byDifficulty[d]);
  return {
    wordsearch: {
      solved: Math.max(a.wordsearch.solved, b.wordsearch.solved),
      byDifficulty: { easy: by("easy"), normal: by("normal"), hard: by("hard") },
      best,
      lastAt: a.wordsearch.lastAt > b.wordsearch.lastAt ? a.wordsearch.lastAt : b.wordsearch.lastAt,
    },
  };
}

/**
 * Записать решённое поле.
 *
 * Время попадает в рекорды, только если игра шла с секундомером и вышла быстрее прежнего.
 * Чистая функция: экран показывает результат, а решает — она.
 */
export function withSolved(
  stats: GameStats,
  themeId: string,
  difficulty: Difficulty,
  seconds: number | null,
  today: string,
): { stats: GameStats; record: boolean } {
  const key = recordKey(themeId, difficulty);
  const previous = stats.wordsearch.best[key];
  const record = seconds !== null && seconds > 0 && (previous === undefined || seconds < previous);
  return {
    stats: {
      wordsearch: {
        solved: stats.wordsearch.solved + 1,
        byDifficulty: {
          ...stats.wordsearch.byDifficulty,
          [difficulty]: (stats.wordsearch.byDifficulty[difficulty] ?? 0) + 1,
        },
        best: record ? { ...stats.wordsearch.best, [key]: seconds as number } : { ...stats.wordsearch.best },
        lastAt: today,
      },
    },
    record,
  };
}

/** «3:07» — время так, как его читают вслух. */
export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
