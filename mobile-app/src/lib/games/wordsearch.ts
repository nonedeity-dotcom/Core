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

/**
 * Куда могут идти слова. Только по клеткам, без диагоналей.
 *
 * Диагонали убраны совсем и намеренно. Слово, которое поворачивает, и слово, которое идёт
 * наискось, — это разные вещи: первое складывается в «П», «Г», зигзаг, и его видно как
 * фигуру; второе просто косая линия, и вместе с поворотами оно превращает поле в кашу, где
 * не понять, куда слово пошло дальше.
 */
export const DIRECTIONS: Record<Difficulty, Dir[]> = {
  // Вправо и вниз: так читают, и искать почти не приходится — это и есть «лёгкий».
  easy: [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
  ],
  // Все четыре стороны: слово может пойти и влево, и вверх.
  normal: [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: -1, dc: 0 },
  ],
  hard: [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: -1, dc: 0 },
  ],
};

export const SIZES: Record<Difficulty, number> = { easy: 8, normal: 10, hard: 12 };

/**
 * Сколько раз слово может повернуть.
 *
 * Прямое слово — это путь с нулём поворотов, поэтому отдельного случая для него нет: вся
 * разница между лёгким и сложным здесь, в одном числе. Два поворота — это уже «П» или
 * зигзаг; четыре — змейка. Больше не нужно: слово перестаёт быть фигурой и становится
 * клубком, который не столько ищут, сколько распутывают.
 */
export const TURNS: Record<Difficulty, number> = { easy: 0, normal: 2, hard: 4 };

/** Сколько слов прячется. Больше — не сложнее, а дольше: поле просто забивается плотнее. */
export const WORD_COUNTS: Record<Difficulty, number> = { easy: 6, normal: 8, hard: 10 };

/**
 * Цвета найденных слов.
 *
 * Шесть, и они перебираются по кругу. Раньше все найденные клетки красились одинаково, и два
 * слова, лежащие рядом или пересекающиеся, сливались в одно пятно: видно, что найдено, но не
 * видно, что именно. Теперь каждое слово — своя полоса своего цвета, и повороты читаются
 * вместе с ней.
 *
 * Это единственное место в приложении, где цветов больше двух, и это осознанно: здесь они не
 * значат «внимание» и «в порядке», а просто отличают одно от другого.
 */
export const WORD_COLORS = ["#e08a55", "#8fb89a", "#5c8fd6", "#c58ac8", "#d6c35c", "#6fc3c0"];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Лёгкий",
  normal: "Средний",
  hard: "Сложный",
};

export const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: "8×8, слова прямые — вправо и вниз",
  normal: "10×10, любая сторона и до двух поворотов — «П», «Г»",
  hard: "12×12, до четырёх поворотов — слово вьётся змейкой",
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

/** Можно ли поставить эту букву в эту клетку: пусто или ровно она же. */
function free(grid: string[][], cell: Cell, letter: string, used: Set<string>): boolean {
  if (!inside(grid.length, cell.row, cell.col)) return false;
  // Дважды через одну клетку слово не проходит: путь, пересекающий сам себя, пальцем не
  // провести — на второй раз он читается как возврат назад.
  if (used.has(`${cell.row}:${cell.col}`)) return false;
  const there = grid[cell.row][cell.col];
  return there === "" || there === letter;
}

/**
 * Путь под слово: прямые куски, между ними повороты.
 *
 * Перебор с откатом, а не «выбрать направление и идти»: после поворота дорога может
 * упереться, и тогда единственный выход — вернуться на букву назад и повернуть иначе.
 * Слово из восьми букв с тремя поворотами почти никогда не ложится с первого раза.
 *
 * Пересечения с уже лежащими словами разрешены и нужны: слово, легшее поверх чужой буквы,
 * которая с ним совпала, связывает поле. Не совпала — здесь не встанет.
 */
function carve(
  grid: string[][],
  word: string,
  start: Cell,
  dirs: Dir[],
  maxTurns: number,
  rnd: Rnd,
): Cell[] | null {
  const used = new Set<string>();
  const path: Cell[] = [];

  const step = (index: number, dir: Dir | null, turnsLeft: number): boolean => {
    if (index === word.length) return true;
    const cell = index === 0 ? start : { row: 0, col: 0 };
    if (index === 0) {
      if (!free(grid, cell, word[0], used)) return false;
      used.add(`${cell.row}:${cell.col}`);
      path.push(cell);
      // Первый шаг направления ещё не имеет — его выбирает следующая буква.
      for (const next of shuffled(dirs, rnd)) {
        if (step(1, next, turnsLeft)) return true;
      }
      used.delete(`${cell.row}:${cell.col}`);
      path.pop();
      return false;
    }

    const previous = path[path.length - 1];
    /*
     * Идти прямо всегда можно; поворачивать — пока есть запас.
     *
     * Что пробовать первым, решает жребий, и он взвешен: чем больше поворотов осталось
     * потратить и чем меньше букв впереди, тем вероятнее повернуть прямо сейчас. Без этого
     * запас так и оставался неистраченным — прямое направление пробовалось первым и почти
     * всегда проходило, так что слово с разрешёнными четырьмя поворотами укладывалось
     * ровной палкой. «П» при этом не выпадала почти никогда, а она и есть то, ради чего
     * повороты заводились.
     */
    const lettersLeft = Math.max(1, word.length - index);
    const wantTurn = turnsLeft > 0 && rnd() < turnsLeft / lettersLeft;
    const others = shuffled(dirs, rnd).filter((d) => !dir || d.dr !== dir.dr || d.dc !== dir.dc);
    const options =
      turnsLeft <= 0 ? [dir as Dir] : wantTurn ? [...others, dir as Dir] : [dir as Dir, ...others];
    for (const option of options) {
      const turned = !dir || option.dr !== dir.dr || option.dc !== dir.dc;
      if (turned && turnsLeft <= 0) continue;
      const next = { row: previous.row + option.dr, col: previous.col + option.dc };
      if (!free(grid, next, word[index], used)) continue;
      used.add(`${next.row}:${next.col}`);
      path.push(next);
      if (step(index + 1, option, turnsLeft - (turned ? 1 : 0))) return true;
      used.delete(`${next.row}:${next.col}`);
      path.pop();
    }
    return false;
  };

  return step(0, null, maxTurns) ? [...path] : null;
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
  const turns = TURNS[difficulty];
  for (const word of chosen) {
    // Запас поворотов у каждого слова свой, от нуля до предела сложности: иначе «до трёх
    // поворотов» на деле означало бы «ровно столько, сколько влезет», и прямых слов на поле
    // не осталось бы вовсе.
    const budget = Math.floor(rnd() * (turns + 1));
    // Сто попыток на слово: случайная клетка старта, дальше путь ищется перебором. Обходить
    // всё поле подряд было бы честнее и заметно дольше, а разницы на таких размерах нет.
    for (let attempt = 0; attempt < 100; attempt++) {
      const start = { row: Math.floor(rnd() * size), col: Math.floor(rnd() * size) };
      const cells = carve(grid, word, start, dirs, budget, rnd);
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

/** Соседняя ли клетка — по стороне. Диагональ соседством не считается: слова так не ходят. */
export const adjacent = (a: Cell, b: Cell): boolean =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

/**
 * Дорога от одной клетки к другой углом: сперва по строке, потом по столбцу (или наоборот).
 *
 * Нужна затем, что палец ходит по диагонали, а слова — нет. Перевёл палец на клетку наискось —
 * и без этого путь бы встал: соседней она не считается, прямой между ними нет. Угол достраивает
 * недостающую клетку сам, и ведение остаётся непрерывным, каким оно и было на самом деле.
 */
function corner(from: Cell, to: Cell, first: "row" | "col"): Cell[] | null {
  const out: Cell[] = [];
  let cursor = from;
  const stepTo = (target: Cell) => {
    while (cursor.row !== target.row || cursor.col !== target.col) {
      cursor = {
        row: cursor.row + Math.sign(target.row - cursor.row),
        col: cursor.col + Math.sign(target.col - cursor.col),
      };
      out.push(cursor);
      if (out.length > 64) return false;
    }
    return true;
  };
  const bend = first === "row" ? { row: from.row, col: to.col } : { row: to.row, col: from.col };
  if (!stepTo(bend) || !stepTo(to)) return null;
  return out;
}

/**
 * Путь, дополненный новой клеткой, — или прежний, если она не годится.
 *
 * Здесь три правила, и каждое взято из того, как палец ведут на самом деле.
 *
 * Возврат на предпоследнюю клетку стирает последнюю. Иначе исправить промах можно было бы
 * только отпустив палец и начав слово заново — а промахиваются на повороте постоянно.
 *
 * Разрыв достраивается углом. Палец едет быстрее, чем приходят события, и срезает повороты
 * наискось; ни то, ни другое не должно рвать путь — человек вёл непрерывно, и путь должен
 * быть таким же. Угол пробуется в обе стороны: одна из них может упереться в клетку, которая
 * в этом слове уже занята.
 *
 * Всё остальное — клетка за краем, путь, наступающий сам на себя, — просто игнорируется.
 * Путь замирает и ждёт, а не ломается.
 */
export function extendPath(path: Cell[], cell: Cell): Cell[] {
  if (path.length === 0) return [cell];
  const last = path[path.length - 1];
  if (sameCell(last, cell)) return path;

  if (path.length >= 2 && sameCell(path[path.length - 2], cell)) return path.slice(0, -1);

  for (const first of ["row", "col"] as const) {
    const route = adjacent(last, cell) ? [cell] : corner(last, cell, first);
    if (!route) continue;
    if (route.some((step) => path.some((c) => sameCell(c, step)))) continue;
    return [...path, ...route];
  }
  return path;
}
