/**
 * «Найди слова»: поле из букв, в котором спрятаны слова.
 *
 * Поле складывается прямо на телефоне и каждый раз заново — в этой игре нет уровней,
 * которые надо заготавливать, потому что проверять чужой ввод здесь не нужно. Человек не
 * придумывает слова, а находит те, что уже положены, — значит, большого словаря не нужно
 * вовсе, хватает списка по теме.
 *
 * Модуль чистый и без случайности внутри: источник случайных чисел приходит снаружи. Одно и
 * то же зерно даёт одно и то же поле, и поэтому игру можно гонять в node, а не на телефоне.
 */

export type Difficulty = "easy" | "normal" | "hard";

export interface Dir {
  dr: number;
  dc: number;
}

/** Куда могут идти слова. Чем сложнее, тем больше направлений — и назад тоже. */
export const DIRECTIONS: Record<Difficulty, Dir[]> = {
  // Только вправо и вниз: так читают, и искать почти не приходится — это и есть «лёгкий».
  easy: [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
  ],
  // Плюс две диагонали вниз.
  normal: [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
    { dr: 1, dc: -1 },
  ],
  // Все восемь: слово может идти справа налево и снизу вверх.
  hard: [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 0, dc: -1 },
    { dr: -1, dc: 0 },
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
  ],
};

export const SIZES: Record<Difficulty, number> = { easy: 8, normal: 10, hard: 12 };

/** Сколько слов прячется. Больше — не сложнее, а дольше: поле просто забивается плотнее. */
export const WORD_COUNTS: Record<Difficulty, number> = { easy: 6, normal: 8, hard: 10 };

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Лёгкий",
  normal: "Средний",
  hard: "Сложный",
};

export const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: "8×8, слова только вправо и вниз",
  normal: "10×10, добавляются диагонали",
  hard: "12×12, слова могут идти задом наперёд",
};

export interface Cell {
  row: number;
  col: number;
}

export interface Placed {
  word: string;
  /** Клетки по порядку букв — по ним же и сверяется найденное. */
  cells: Cell[];
}

export interface Puzzle {
  size: number;
  difficulty: Difficulty;
  /** Буквы поля: grid[row][col]. */
  grid: string[][];
  words: Placed[];
}

/** Источник случайных чисел снаружи, чтобы поле можно было повторить и проверить. */
export type Rnd = () => number;

/**
 * Буквы для пустых клеток, с поправкой на то, как часто они встречаются в русском.
 *
 * Равновероятный набор выдаёт поле, усыпанное Ъ, Щ и Ф, — на такое смотреть неприятно и
 * искать в нём легче, чем нужно: редкая буква сама указывает, где слова нет.
 */
const FILLER = "ААААОООООЕЕЕЕИИИИННННТТТТСССРРРВВВЛЛЛКККМММДДПППУУЯЯЫЫЬГГЗЗБЧЙХЖШЮЦЩЭФЪ";

const shuffled = <T,>(items: T[], rnd: Rnd): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const inside = (size: number, row: number, col: number) => row >= 0 && col >= 0 && row < size && col < size;

/**
 * Куда встанет слово из этой клетки в эту сторону — или никуда.
 *
 * Пересечения разрешены и нужны: слово, легшее поверх чужой буквы, которая с ним совпала,
 * связывает поле и делает его интереснее. Не совпала — значит здесь не встанет.
 */
function fit(grid: string[][], word: string, row: number, col: number, dir: Dir): Cell[] | null {
  const size = grid.length;
  const cells: Cell[] = [];
  for (let i = 0; i < word.length; i++) {
    const r = row + dir.dr * i;
    const c = col + dir.dc * i;
    if (!inside(size, r, c)) return null;
    const there = grid[r][c];
    if (there !== "" && there !== word[i]) return null;
    cells.push({ row: r, col: c });
  }
  return cells;
}

/**
 * Поле с запрятанными словами.
 *
 * Слова берутся длинными вперёд: длинное встаёт тяжелее, и если начать с коротких, они
 * займут середину и длинному места не останется. Не поместившееся слово просто
 * пропускается — поле с семью словами вместо восьми играется нормально, а поле, собранное
 * наполовину и зависшее, не играется вовсе.
 */
export function makePuzzle(words: string[], difficulty: Difficulty, rnd: Rnd): Puzzle {
  const size = SIZES[difficulty];
  const dirs = DIRECTIONS[difficulty];
  const grid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ""));

  const usable = words.filter((w) => w.length >= 3 && w.length <= size);
  const chosen = shuffled(usable, rnd)
    .slice(0, WORD_COUNTS[difficulty] * 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, WORD_COUNTS[difficulty]);

  const placed: Placed[] = [];
  for (const word of chosen) {
    // Двести попыток на слово: случайная клетка, случайное направление. Перебирать всё поле
    // подряд было бы честнее и заметно медленнее, а разницы на таких размерах нет.
    for (let attempt = 0; attempt < 200; attempt++) {
      const dir = dirs[Math.floor(rnd() * dirs.length)];
      const row = Math.floor(rnd() * size);
      const col = Math.floor(rnd() * size);
      const cells = fit(grid, word, row, col, dir);
      if (!cells) continue;
      cells.forEach((cell, i) => {
        grid[cell.row][cell.col] = word[i];
      });
      placed.push({ word, cells });
      break;
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === "") grid[r][c] = FILLER[Math.floor(rnd() * FILLER.length)];
    }
  }

  return { size, difficulty, grid, words: placed };
}

/**
 * Клетки от первой до последней — но только если между ними прямая.
 *
 * Слово в этой игре всегда лежит по прямой, поэтому палец не надо вести по буквам: хватает
 * того, с какой клетки начал и над какой сейчас. Всё, что не строка, не столбец и не
 * диагональ, — не выделение, а случайное движение пальца, и отвечать на него нечем.
 */
export function lineBetween(from: Cell, to: Cell): Cell[] | null {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (dr === 0 && dc === 0) return [from];
  const straight = dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
  if (!straight) return null;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);
  return Array.from({ length: steps + 1 }, (_, i) => ({ row: from.row + stepR * i, col: from.col + stepC * i }));
}

export const sameCell = (a: Cell, b: Cell): boolean => a.row === b.row && a.col === b.col;

/** Буквы вдоль выделения, в порядке ведения пальца. */
export const lettersAt = (puzzle: Puzzle, cells: Cell[]): string =>
  cells.map((c) => puzzle.grid[c.row][c.col]).join("");

/**
 * Какое слово выделено — если выделено.
 *
 * Сверяется по буквам, а не по клеткам, и это стоило одной переделки. Сначала здесь стояло
 * сравнение с теми самыми клетками, куда слово положили, — строго и, казалось бы, правильно.
 * На проверке вышло вот что: буквы-заполнители иногда складываются в то же слово в другом
 * месте, человек честно его там находит, ведёт палец — и не происходит ничего. Ни ошибки, ни
 * подсказки: игра просто молчит, потому что «это не то ГРЕЧКА». Объяснить такое нельзя, и
 * правильным оно быть перестаёт.
 *
 * Теперь засчитывается любая прямая, читающаяся как слово из списка. В обе стороны: вести
 * палец справа налево так же естественно, как слева направо.
 */
export function findMatch(puzzle: Puzzle, cells: Cell[], found: string[] = []): string | null {
  if (cells.length < 2) return null;
  const forward = lettersAt(puzzle, cells);
  const backward = [...forward].reverse().join("");
  const hit = puzzle.words.find(
    (p) => !found.includes(p.word) && (p.word === forward || p.word === backward),
  );
  return hit ? hit.word : null;
}

/** Решено ли поле целиком. */
export const allFound = (puzzle: Puzzle, found: string[]): boolean =>
  puzzle.words.length > 0 && puzzle.words.every((p) => found.includes(p.word));

/**
 * Генератор случайных чисел с зерном.
 *
 * Свой, а не Math.random, ровно по одной причине: с зерном поле повторяется, а значит его
 * можно проверить в node и вернуться к тому же самому при разборе ошибки.
 */
export function seeded(seed: number): Rnd {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
