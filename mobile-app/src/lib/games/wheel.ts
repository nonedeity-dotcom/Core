import LEVELS from "../../content/wheelLevels.json";

/**
 * «Колесо букв»: из букв по кругу собираются слова, и они ложатся в кроссворд.
 *
 * Уровни собраны заранее (tools/wheel/build-levels.js) и лежат готовыми: в телефон не едет
 * словарь, уровню хватает своих слов — тех, что в сетке, и тех, что засчитываются бонусом.
 * Модуль ничего не знает ни про экраны, ни про хранилище.
 */

export type Dir = "h" | "v";

/** Слово в сетке: само слово, строка и столбец первой буквы, направление. */
export type Entry = [string, number, number, Dir];

export interface WheelLevel {
  /** Буквы колеса — уже перемешанные. */
  letters: string;
  rows: number;
  cols: number;
  words: Entry[];
  /** Настоящие слова из этих букв, которых нет в сетке. */
  bonus: string[];
}

export interface Cell {
  row: number;
  col: number;
}

export const WHEEL_LEVELS = LEVELS as WheelLevel[];

/** Уровень по номеру с нуля. После последнего игра идёт по кругу, а не кончается. */
export const levelAt = (index: number): WheelLevel => WHEEL_LEVELS[index % WHEEL_LEVELS.length];

export const cellsOf = ([word, row, col, dir]: Entry): Cell[] =>
  [...word].map((_, i) => (dir === "h" ? { row, col: col + i } : { row: row + i, col }));

const key = (c: Cell) => `${c.row}:${c.col}`;

/** Буква в каждой клетке сетки. Пересечение даёт одну и ту же букву — так уровни и собраны. */
export function letterMap(level: WheelLevel): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of level.words) cellsOf(e).forEach((c, i) => map.set(key(c), e[0][i]));
  return map;
}

export type Verdict =
  /** Слово из сетки — встаёт на место. */
  | "grid"
  /** Настоящее слово, которого нет в сетке. */
  | "bonus"
  /** Уже было. */
  | "again"
  /** Такого слова нет. */
  | "miss";

export function judge(level: WheelLevel, found: string[], bonusFound: string[], word: string): Verdict {
  if (word.length < 3) return "miss";
  if (found.includes(word) || bonusFound.includes(word)) return "again";
  if (level.words.some((e) => e[0] === word)) return "grid";
  if (level.bonus.includes(word)) return "bonus";
  return "miss";
}

/** Клетки, где буква уже видна: из найденных слов и открытые подсказкой. */
export function visibleCells(level: WheelLevel, found: string[], hinted: Cell[]): Set<string> {
  const out = new Set(hinted.map(key));
  for (const e of level.words) if (found.includes(e[0])) cellsOf(e).forEach((c) => out.add(key(c)));
  return out;
}

/**
 * Слова, которые открылись сами — все их буквы уже видны.
 *
 * Подсказки и пересечения могут открыть слово целиком, так и не дав его собрать. Заставлять
 * после этого вести пальцем по буквам, которые и так все на виду, — это не игра, а обряд.
 */
export function uncovered(level: WheelLevel, found: string[], hinted: Cell[]): string[] {
  const seen = visibleCells(level, found, hinted);
  return level.words
    .filter((e) => !found.includes(e[0]) && cellsOf(e).every((c) => seen.has(key(c))))
    .map((e) => e[0]);
}

export const solved = (level: WheelLevel, found: string[]): boolean =>
  level.words.every((e) => found.includes(e[0]));

/**
 * Какую клетку открыть подсказкой.
 *
 * Первую скрытую букву в самом коротком ещё не найденном слове: короткое слово с открытой
 * первой буквой почти всегда угадывается, и подсказка тратится на то, чтобы сдвинуть с
 * места, а не на то, чтобы решить за человека.
 */
export function hintCell(level: WheelLevel, found: string[], hinted: Cell[]): Cell | null {
  const seen = visibleCells(level, found, hinted);
  const open = level.words.filter((e) => !found.includes(e[0])).sort((a, b) => a[0].length - b[0].length);
  for (const e of open) {
    const hidden = cellsOf(e).find((c) => !seen.has(key(c)));
    if (hidden) return hidden;
  }
  return null;
}

/**
 * Путь пальца по колесу — по номерам букв, а не по самим буквам.
 *
 * Номера, потому что буквы повторяются: в «БАБОЧКЕ» две «Б» и две «А», и путь по буквам не
 * отличил бы вторую «Б» от первой. Одну и ту же букву колеса дважды не взять; шаг назад —
 * на предпоследнюю — снимает последнюю, как стирание.
 */
export function extendWheelPath(path: number[], index: number): number[] {
  if (path.length >= 2 && path[path.length - 2] === index) return path.slice(0, -1);
  if (path.includes(index)) return path;
  return [...path, index];
}

export const wordOf = (letters: string, path: number[]): string => path.map((i) => letters[i]).join("");

/** Перемешать колесо: те же буквы, другой порядок. Путь при этом сбрасывается. */
export function shuffled(letters: string, rnd: () => number): string {
  const a = [...letters];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const out = a.join("");
  // Перемешать и получить то же самое — это кнопка, которая ничего не сделала.
  return out === letters && letters.length > 1 ? letters.slice(1) + letters[0] : out;
}
