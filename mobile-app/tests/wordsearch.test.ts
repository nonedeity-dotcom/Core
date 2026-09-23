import { eq, ok, test } from "./harness";
import {
  CROSSINGS,
  FULL_FILL,
  adjacent,
  extendPath,
  findMatch,
  lettersAt,
  makePuzzle,
  seeded,
  type Cell,
  type Difficulty,
} from "../src/lib/games/wordsearch";
import { WORD_THEMES } from "../src/content/wordThemes";

const words = WORD_THEMES[0].words;
const key = (c: Cell) => `${c.row}:${c.col}`;

test("поле собирается и честное", () => {
  for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
    for (let seed = 1; seed <= 15; seed++) {
      const p = makePuzzle(words, difficulty, seeded(seed));
      const label = `${difficulty}, зерно ${seed}`;
      ok(`${label}: каждое слово лежит там, где сказано`, p.words.every((w) => lettersAt(p, w.cells) === w.word));
      ok(`${label}: без диагоналей`, p.words.every((w) => w.cells.every((c, i) => i === 0 || adjacent(w.cells[i - 1], c))));
      const used = p.words.flatMap((w) => w.cells.map(key));
      if (!CROSSINGS[difficulty]) ok(`${label}: слова не делят буквы`, new Set(used).size === used.length);
      if (FULL_FILL[difficulty]) ok(`${label}: каждая клетка — чьё-то слово`, new Set(used).size === p.size * p.size);
    }
  }
});

test("одно зерно — одно поле", () => {
  eq("повторяется", makePuzzle(words, "normal", seeded(7)).grid, makePuzzle(words, "normal", seeded(7)).grid);
});

test("находка по буквам, в обе стороны", () => {
  const p = makePuzzle(words, "easy", seeded(3));
  const w = p.words[0];
  eq("вперёд", findMatch(p, w.cells), w.word);
  eq("задом наперёд", findMatch(p, [...w.cells].reverse()), w.word);
  eq("уже найденное второй раз не находится", findMatch(p, w.cells, [w.word]), null);
});

test("путь пальца", () => {
  const a = { row: 0, col: 0 };
  const b = { row: 0, col: 1 };
  const c = { row: 1, col: 1 };
  eq("шаг", extendPath([a], b), [a, b]);
  eq("назад — снимает последнюю", extendPath([a, b], a), [a]);
  eq("через угол — достраивает угол", extendPath([a], c).length, 3);
  eq("закрытая клетка не пускает", extendPath([a], b, (x) => x.col === 1), [a]);
});
