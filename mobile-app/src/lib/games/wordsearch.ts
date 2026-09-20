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

/**
 * Можно ли двум словам делить одну букву.
 *
 * Пересечение — отдельная и немалая трудность: буква принадлежит сразу двум словам, и глаз,
 * дойдя до неё, перестаёт понимать, какое из них он читает. На поле с поворотами это
 * особенно заметно — не видно, куда слово свернуло, а куда просто ушло чужое.
 *
 * Поэтому на лёгком и среднем слова лежат каждое само по себе и только соприкасаются
 * боками, а делить буквы им нельзя. На сложном — можно, и это ровно та разница, которая
 * делает сложный сложным, помимо размера.
 */
export const CROSSINGS: Record<Difficulty, boolean> = { easy: false, normal: false, hard: true };

/**
 * Забивается ли поле словами целиком, без единой случайной буквы.
 *
 * Когда случайных букв нет, найденные слова закрашивают поле, и то, что осталось белым, —
 * это ровно последнее слово. Оно выдаёт себя само, и конец партии перестаёт быть вычёсыванием
 * поля по клеточке. На лёгком и среднем это то, что нужно.
 *
 * На сложном — нет: там случайные буквы и есть главная помеха, а поле 12×12, забитое
 * словами без остатка, ещё и складывается далеко не всегда.
 */
export const FULL_FILL: Record<Difficulty, boolean> = { easy: true, normal: true, hard: false };

/** Короче трёх букв слов в темах нет — по этому числу и судят, заполнима ли дырка. */
const MIN_WORD = 3;

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
  hard: "12×12, до четырёх поворотов, слова делят буквы",
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

/** Можно ли поставить эту букву в эту клетку. */
function free(
  grid: string[][],
  cell: Cell,
  letter: string,
  used: Set<string>,
  crossings: boolean,
): boolean {
  if (!inside(grid.length, cell.row, cell.col)) return false;
  // Дважды через одну клетку слово не проходит — и это правило своё, не про пересечения:
  // путь, наступающий сам на себя, пальцем не провести, на второй раз он читается как
  // возврат назад.
  if (used.has(`${cell.row}:${cell.col}`)) return false;
  const there = grid[cell.row][cell.col];
  if (there === "") return true;
  // Занятая клетка годится, только если буква та же и пересечения вообще разрешены.
  return crossings && there === letter;
}

/**
 * Путь под слово: прямые куски, между ними повороты.
 *
 * Перебор с откатом, а не «выбрать направление и идти»: после поворота дорога может
 * упереться, и тогда единственный выход — вернуться на букву назад и повернуть иначе.
 * Слово из восьми букв с тремя поворотами почти никогда не ложится с первого раза.
 *
 * Пересечения — по сложности: на лёгком и среднем клетка должна быть пустой, на сложном
 * годится и занятая, если буква та же.
 */
function carve(
  grid: string[][],
  word: string,
  start: Cell,
  dirs: Dir[],
  maxTurns: number,
  crossings: boolean,
  rnd: Rnd,
  /**
   * Запас шагов вглубь.
   *
   * Удачная укладка находится быстро — она возвращается на первом же подошедшем пути.
   * Неудачная стоит дорого: чтобы честно сказать «сюда это слово не встанет», надо обойти
   * всё дерево, а оно растёт как четыре в степени длины слова. На почти заполненном поле
   * такие отказы идут сотнями подряд, и без запаса одно поле 10×10 считалось дольше минуты.
   */
  budget = { left: 800 },
): Cell[] | null {
  const used = new Set<string>();
  const path: Cell[] = [];

  const step = (index: number, dir: Dir | null, turnsLeft: number): boolean => {
    if (index === word.length) return true;
    if (budget.left-- <= 0) return false;
    const cell = index === 0 ? start : { row: 0, col: 0 };
    if (index === 0) {
      if (!free(grid, cell, word[0], used, crossings)) return false;
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
      if (!free(grid, next, word[index], used, crossings)) continue;
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
/**
 * Размеры пустых кусков поля — по сторонам клеток, потому что и слова ходят только так.
 *
 * Клетки здесь считаются числами, а не парами и не строками вида «3:7». Это не украшение:
 * проверка гоняется тысячи раз за одно поле, и на строковых ключах она одна съедала секунды —
 * миллионы коротких строк, каждую из которых надо создать и тут же выбросить.
 *
 * `stopAt` обрывает обход, как только нашёлся кусок меньше нужного: дальше считать незачем,
 * ответ уже известен.
 */
function regionSizes(grid: string[][], stopAt = 0): number[] {
  const size = grid.length;
  const seen = new Uint8Array(size * size);
  const stack = new Int32Array(size * size);
  const sizes: number[] = [];
  for (let start = 0; start < size * size; start++) {
    if (seen[start] || grid[(start / size) | 0][start % size] !== "") continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let count = 0;
    while (top > 0) {
      const index = stack[--top];
      const r = (index / size) | 0;
      const c = index % size;
      count++;
      if (c + 1 < size && !seen[index + 1] && grid[r][c + 1] === "") { seen[index + 1] = 1; stack[top++] = index + 1; }
      if (c > 0 && !seen[index - 1] && grid[r][c - 1] === "") { seen[index - 1] = 1; stack[top++] = index - 1; }
      if (r + 1 < size && !seen[index + size] && grid[r + 1][c] === "") { seen[index + size] = 1; stack[top++] = index + size; }
      if (r > 0 && !seen[index - size] && grid[r - 1][c] === "") { seen[index - size] = 1; stack[top++] = index - size; }
    }
    sizes.push(count);
    if (stopAt > 0 && count < stopAt) return sizes;
  }
  return sizes;
}

/**
 * Поле, забитое словами без остатка.
 *
 * Перебор с откатом по той же схеме, что и укладка одного слова, только на этаж выше: берём
 * самую верхнюю левую пустую клетку и пробуем начать с неё какое-нибудь слово. Не вышло —
 * пробуем следующее; кончились слова — откатываемся и переигрываем предыдущее.
 *
 * Всё держится на одной отсечке: после каждой укладки пустота не должна распадаться на куски
 * меньше трёх клеток. Дырка в одну-две клетки не заполнима ничем, и без этой проверки перебор
 * находил её только на самом дне, перебрав до того тысячи заведомо мёртвых веток.
 *
 * Запас шагов ограничен, и это не перестраховка: восьмёрка на восемь ложится почти всегда, а
 * вот редкая неудачная тема или размер могут не сойтись вовсе. Не сошлось — зовущий кладёт
 * обычное поле со случайными буквами, и человек этого даже не заметит.
 */
function packFull(
  grid: string[][],
  words: string[],
  difficulty: Difficulty,
  rnd: Rnd,
  budget = { left: 800 },
): Placed[] | null {
  const size = grid.length;
  const dirs = DIRECTIONS[difficulty];
  const turns = TURNS[difficulty];
  const used = new Set<string>();
  const placed: Placed[] = [];

  const firstEmpty = (): Cell | null => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c] === "") return { row: r, col: c };
    return null;
  };

  const step = (): boolean => {
    const start = firstEmpty();
    if (!start) return true;
    // Запас тратится и здесь, а не только на поиск пути. Без этого дерево самой упаковки
    // росло даром: удачная укладка стоит несколько шагов, откат — ноль, и перебор успевал
    // обойти миллионы веток, не потратив запаса. Одно поле 10×10 считалось шестнадцать
    // секунд и всё-таки сходилось — на телефоне это застывший экран.
    if (budget.left-- <= 0) return false;

    /*
     * Слова отбираются по размеру дырки, а не перебираются все подряд, и это разница между
     * «считает полсекунды» и «не досчитывает вовсе». В кусок из пяти клеток слово на семь
     * букв не влезет никогда, а слово на четыре оставит за собой одну клетку, которую уже
     * ничем не закрыть. Пробовать их обоих — чистая трата перебора.
     *
     * Длинные идут первыми: чем крупнее кусок, тем меньше после него обрывков.
     */
    const room = regionSizes(grid)[0];
    const fitting = shuffled(
      words.filter((w) => !used.has(w) && w.length <= room && (room - w.length === 0 || room - w.length >= MIN_WORD)),
      rnd,
    ).sort((a, b) => b.length - a.length);

    for (const word of fitting) {
      // Поворотов столько, сколько позволяет сложность: здесь они не для красоты, а для того,
      // чтобы слово могло обойти уже занятое и не оставить за собой дырку.
      const cells = carve(grid, word, start, dirs, turns, false, rnd);
      if (!cells) continue;
      cells.forEach((cell, i) => {
        grid[cell.row][cell.col] = word[i];
      });
      if (regionSizes(grid, MIN_WORD).every((n) => n >= MIN_WORD)) {
        used.add(word);
        placed.push({ word, cells });
        if (step()) return true;
        used.delete(word);
        placed.pop();
      }
      cells.forEach((cell) => {
        grid[cell.row][cell.col] = "";
      });
      if (budget.left <= 0) return false;
    }
    return false;
  };

  return step() ? placed : null;
}

export function makePuzzle(words: string[], difficulty: Difficulty, rnd: Rnd): Puzzle {
  const size = SIZES[difficulty];
  const dirs = DIRECTIONS[difficulty];
  const grid: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ""));

  const usable = words.filter((w) => w.length >= MIN_WORD && w.length <= size);

  if (FULL_FILL[difficulty]) {
    /*
     * Три попытки с чистого листа вместо одной длинной.
     *
     * Упаковка проваливается почти всегда из-за неудачного слова в самом начале: оно легло
     * поперёк поля, и дальше уже ничего не сходится, сколько ни перебирай хвост. Начать
     * заново с другим жребием дешевле, чем доказывать, что из этого начала выхода нет, — и
     * помогает заметно чаще. Три попытки по восемьсот шагов вытягивают столько же, сколько
     * одна на две с половиной тысячи, и укладываются в полтораста миллисекунд.
     */
    for (let attempt = 0; attempt < 3; attempt++) {
      const packed = packFull(grid, usable, difficulty, rnd);
      if (packed) return { size, difficulty, grid, words: packed };
      // Сетка могла остаться исписанной откатами не до конца — чистим перед следующей
      // попыткой и перед обычной укладкой.
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) grid[r][c] = "";
    }
  }

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
      const cells = carve(grid, word, start, dirs, budget, CROSSINGS[difficulty], rnd);
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
 * Закрытые клетки — те, где уже лежит найденное слово, — путь не пропускают вовсе: ни как
 * цель, ни как середину достроенного угла. Закрывать их или нет, решает сложность. Там, где
 * слова делят буквы, закрывать нельзя: через найденную букву проходит ещё не найденное
 * слово, и запрет сделал бы его недостижимым. Там, где не делят, проводить пальцем по уже
 * разгаданному незачем — это только путает.
 *
 * Всё остальное — клетка за краем, путь, наступающий сам на себя, — просто игнорируется.
 * Путь замирает и ждёт, а не ломается.
 */
export function extendPath(path: Cell[], cell: Cell, blocked?: (cell: Cell) => boolean): Cell[] {
  const shut = (c: Cell) => blocked !== undefined && blocked(c);
  if (path.length === 0) return shut(cell) ? [] : [cell];
  const last = path[path.length - 1];
  if (sameCell(last, cell)) return path;

  if (path.length >= 2 && sameCell(path[path.length - 2], cell)) return path.slice(0, -1);

  for (const first of ["row", "col"] as const) {
    const route = adjacent(last, cell) ? [cell] : corner(last, cell, first);
    if (!route) continue;
    if (route.some((step) => shut(step) || path.some((c) => sameCell(c, step)))) continue;
    return [...path, ...route];
  }
  return path;
}
