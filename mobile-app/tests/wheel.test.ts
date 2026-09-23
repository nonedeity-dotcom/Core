import { eq, ok, test } from "./harness";
import {
  WHEEL_LEVELS,
  cellsOf,
  extendWheelPath,
  hintCell,
  judge,
  letterMap,
  levelAt,
  shuffled,
  solved,
  uncovered,
  visibleCells,
  wordOf,
  type WheelLevel,
} from "../src/lib/games/wheel";

/** Хватает ли букв колеса на слово — с учётом повторов. */
const fits = (letters: string, word: string): boolean => {
  const left = [...letters];
  for (const ch of word) {
    const i = left.indexOf(ch);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
};

test("каждый уровень собран честно", () => {
  eq("уровней", WHEEL_LEVELS.length, 300);
  WHEEL_LEVELS.forEach((level, n) => {
    const label = `уровень ${n + 1}`;
    const grid = level.words.map((e) => e[0]);
    ok(`${label}: слова сетки из букв колеса`, grid.every((w) => fits(level.letters, w)));
    ok(`${label}: бонусные тоже`, level.bonus.every((w) => fits(level.letters, w)));
    ok(`${label}: бонус не повторяет сетку`, level.bonus.every((w) => !grid.includes(w)));
    ok(`${label}: слова не короче трёх`, [...grid, ...level.bonus].every((w) => w.length >= 3));
    ok(`${label}: без повторов в сетке`, new Set(grid).size === grid.length);
    ok(
      `${label}: всё внутри рамки`,
      level.words.every((e) => cellsOf(e).every((c) => c.row >= 0 && c.col >= 0 && c.row < level.rows && c.col < level.cols)),
    );
    // Пересечение даёт одну букву: иначе одна клетка просила бы две разные.
    const seen = new Map<string, string>();
    let agree = true;
    for (const e of level.words) {
      cellsOf(e).forEach((c, i) => {
        const k = `${c.row}:${c.col}`;
        if (seen.has(k) && seen.get(k) !== e[0][i]) agree = false;
        seen.set(k, e[0][i]);
      });
    }
    ok(`${label}: пересечения сходятся`, agree);
    eq(`${label}: карта букв`, letterMap(level).size, seen.size);
  });
});

test("уровни идут по кругу", () => {
  eq("после последнего — первый", levelAt(WHEEL_LEVELS.length), WHEEL_LEVELS[0]);
  eq("номер 0 — первый", levelAt(0), WHEEL_LEVELS[0]);
});

const level: WheelLevel = {
  letters: "КОТЛ",
  rows: 3,
  cols: 4,
  // КОТ по горизонтали, КОЛ вниз от той же «К».
  words: [
    ["КОТ", 0, 0, "h"],
    ["КОЛ", 0, 0, "v"],
  ],
  bonus: ["ТОК"],
};

test("что засчитывается", () => {
  eq("слово сетки", judge(level, [], [], "КОТ"), "grid");
  eq("бонус", judge(level, [], [], "ТОК"), "bonus");
  eq("уже найдено", judge(level, ["КОТ"], [], "КОТ"), "again");
  eq("бонус повторно", judge(level, [], ["ТОК"], "ТОК"), "again");
  eq("нет такого", judge(level, [], [], "ЛОТК"), "miss");
  eq("две буквы — не слово", judge(level, [], [], "ОК"), "miss");
});

test("что видно и что решено", () => {
  eq("ничего не найдено — пусто", visibleCells(level, [], []).size, 0);
  eq("КОТ открыл три клетки", [...visibleCells(level, ["КОТ"], [])].sort(), ["0:0", "0:1", "0:2"]);
  ok("не решено, пока есть слово", !solved(level, ["КОТ"]));
  ok("решено", solved(level, ["КОТ", "КОЛ"]));
  ok("бонус не нужен для решения", solved({ ...level }, ["КОЛ", "КОТ"]));
});

test("подсказка открывает букву, а открытое целиком засчитывается само", () => {
  const first = hintCell(level, [], []);
  eq("первая буква короткого слова", first, { row: 0, col: 0 });
  // После КОТ у КОЛ открыта «К», подсказка — дальше по нему.
  eq("следующая скрытая", hintCell(level, ["КОТ"], []), { row: 1, col: 0 });
  eq("пока не всё видно — само не открывается", uncovered(level, ["КОТ"], [{ row: 1, col: 0 }]), []);
  eq("последняя буква — и слово найдено", uncovered(level, ["КОТ"], [{ row: 1, col: 0 }, { row: 2, col: 0 }]), ["КОЛ"]);
  eq("решённый уровень подсказке не нужен", hintCell(level, ["КОТ", "КОЛ"], []), null);
});

test("путь пальца", () => {
  eq("растёт", extendWheelPath([0, 1], 2), [0, 1, 2]);
  eq("шаг назад стирает", extendWheelPath([0, 1, 2], 1), [0, 1]);
  eq("ту же букву дважды не взять", extendWheelPath([0, 1, 2], 0), [0, 1, 2]);
  eq("на последней стоим — ничего", extendWheelPath([0, 1], 1), [0, 1]);
  eq("буквы по номерам", wordOf("КОТЛ", [0, 1, 2]), "КОТ");
  // Повторы: две «А» — это два разных места колеса.
  eq("повторная буква — другое место", wordOf("ААБ", extendWheelPath([0], 1)), "АА");
});

test("перемешать — значит поменять", () => {
  const same = () => 0.999; // перестановка, которая всё оставляет как было
  const out = shuffled("КОТЛ", same);
  ok("порядок другой", out !== "КОТЛ");
  eq("буквы те же", [...out].sort(), [..."КОТЛ"].sort());
  let r = 1;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20; i++) {
    const s = shuffled("БАБОЧКА", rnd);
    ok(`проход ${i}: те же буквы`, [...s].sort().join("") === [..."БАБОЧКА"].sort().join(""));
    ok(`проход ${i}: не на месте`, s !== "БАБОЧКА");
  }
});
