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
  /** Лучшее время в секундах по ключу «тема:сложность». */
  best: Record<string, number>;
  /** Дата последней игры, "yyyy-MM-dd" — для строки на Главной. */
  lastAt: string;
}

export interface GameStats {
  wordsearch: WordSearchStats;
}

export const EMPTY_WORD_SEARCH: WordSearchStats = { solved: 0, best: {}, lastAt: "" };
export const DEFAULT_GAME_STATS: GameStats = { wordsearch: { ...EMPTY_WORD_SEARCH, best: {} } };

/** Ключ рекорда. Тема и сложность вместе: одно поле 12×12 не сравнивают с полем 8×8. */
export const recordKey = (themeId: string, difficulty: Difficulty): string => `${themeId}:${difficulty}`;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export function normalizeGameStats(raw: unknown): GameStats {
  if (typeof raw !== "object" || raw === null) return { wordsearch: { ...EMPTY_WORD_SEARCH, best: {} } };
  const o = (raw as Record<string, unknown>).wordsearch;
  if (typeof o !== "object" || o === null) return { wordsearch: { ...EMPTY_WORD_SEARCH, best: {} } };
  const w = o as Record<string, unknown>;
  const best: Record<string, number> = {};
  if (typeof w.best === "object" && w.best !== null) {
    for (const [key, value] of Object.entries(w.best as Record<string, unknown>)) {
      const seconds = num(value);
      // Ноль секунд — это не рекорд, а сбой: поле нельзя собрать мгновенно.
      if (seconds > 0) best[key] = seconds;
    }
  }
  return {
    wordsearch: {
      solved: num(w.solved),
      best,
      lastAt: typeof w.lastAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w.lastAt) ? w.lastAt : "",
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
