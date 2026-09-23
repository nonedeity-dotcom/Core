import { eq, ok, test } from "./harness";
import { makeWorld, cellKey, WORLD_SIZE } from "../src/lib/village/world";
import {
  act,
  canCraft,
  cellAt,
  craft,
  currentGoal,
  eat,
  facingCell,
  mergeVillage,
  move,
  newVillage,
  normalizeVillage,
  pickUp,
  place,
  walkable,
  type Dir,
  type VillageState,
} from "../src/lib/village/game";
import { NATURE, RECIPES } from "../src/lib/village/content";

/** Поставить персонажа на свободную клетку лицом к клетке с нужным. */
function faceNature(s: VillageState, id: string): VillageState | null {
  const w = makeWorld(s.seed);
  const dirs: [Dir, number, number][] = [["right", -1, 0], ["left", 1, 0], ["down", 0, -1], ["up", 0, 1]];
  for (let y = 3; y < WORLD_SIZE - 3; y++) {
    for (let x = 3; x < WORLD_SIZE - 3; x++) {
      if (w.nature[y * w.size + x] !== id) continue;
      for (const [facing, dx, dy] of dirs) {
        if (walkable(s, x + dx, y + dy)) return { ...s, x: x + dx, y: y + dy, facing };
      }
    }
  }
  return null;
}

test("мир", () => {
  for (const seed of [1, 7, 42, 2026, 99991]) {
    const w = makeWorld(seed);
    const s = newVillage(seed);
    ok(`зерно ${seed}: старт свободен`, walkable(s, w.start.x, w.start.y));
    ok(`зерно ${seed}: край — лес`, w.nature[0] === "tree" && w.nature[w.size * w.size - 1] === "tree");
    ok(`зерно ${seed}: есть вода`, w.ground.includes("water"));
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => walkable(s, w.start.x + dx, w.start.y + dy));
    ok(`зерно ${seed}: со старта можно уйти`, around.length >= 2);
    const count = (id: string) => w.nature.filter((n) => n === id).length;
    ok(`зерно ${seed}: всего хватает`, ["tree", "bush", "rock", "pebble", "branch"].every((id) => count(id) > 5));
  }
  eq("одно зерно — один мир", makeWorld(5).nature.join(), makeWorld(5).nature.join());
});

test("ходьба", () => {
  const s = newVillage(42);
  const moved = move(s, "right").state;
  ok("шаг", moved.x === s.x + 1 || moved.x === s.x);
  eq("смотрит туда, куда шёл", moved.facing, "right");
  ok("шаг стоит времени", moved.x === s.x || moved.time > s.time);
  const tree = faceNature(s, "tree")!;
  const bumped = move(tree, tree.facing).state;
  eq("в дерево не пройти — только повернуться", [bumped.x, bumped.y, bumped.time], [tree.x, tree.y, tree.time]);
});

test("ветки подбираются на ходу", () => {
  const s = newVillage(42);
  const w = makeWorld(42);
  // Ветка на поляне справа сверху от старта: [2, -1].
  const up = move(s, "up").state;
  const right1 = move(up, "right").state;
  const right2 = move(right1, "right");
  eq("стоит на месте ветки", [right2.state.x, right2.state.y], [w.start.x + 2, w.start.y - 1]);
  eq("и ветки в сумке", right2.state.bag.stick, 2);
  eq("и сказано по-русски", right2.message, "+2 ветки");
});

test("собирать и ждать, пока вырастет", () => {
  let s = faceNature(newVillage(42), "branch")!;
  const t = facingCell(s);
  const r = act(s);
  eq("ветки в сумке", r.state.bag.stick, 2);
  ok("клетка пустая", cellAt(r.state, t.x, t.y)!.depleted);
  eq("второй раз — ничего", act(r.state).state.bag.stick, 2);
  const later = { ...r.state, time: r.state.time + NATURE.branch.regrow };
  ok("через день ветки снова лежат", !cellAt(later, t.x, t.y)!.depleted);

  s = faceNature(newVillage(42), "tree")!;
  eq("без топора не срубить", act(s).state.bag.log, undefined);
  ok("и сказано почему", act(s).message!.includes("топор"));
  const chopped = act({ ...s, bag: { axe: 1 } });
  eq("с топором — брёвна", chopped.state.bag.log, 2);
  ok("остался пень — не пройти", !walkable(chopped.state, facingCell(s).x, facingCell(s).y));

  const hungry = act({ ...faceNature(newVillage(42), "bush")!, food: 0 });
  const fed = act(faceNature(newVillage(42), "bush")!);
  ok("голодному дольше", hungry.state.time - fed.state.time > 0);
});

test("крафт и постройки", () => {
  const axe = RECIPES.find((r) => r.id === "axe")!;
  let s: VillageState = { ...newVillage(42), bag: { stick: 3, stone: 1 } };
  eq("не хватает", canCraft(s, axe).ok, false);
  s = craft({ ...s, bag: { stick: 3, stone: 2 } }, "axe").state;
  eq("топор сделан, ветки потрачены", [s.bag.axe, s.bag.stick, s.bag.stone], [1, 0, 0]);
  eq("второй топор не нужен", canCraft({ ...s, bag: { ...s.bag, stick: 9, stone: 9 } }, axe).ok, false);

  const house = RECIPES.find((r) => r.id === "house")!;
  const rich = { ...newVillage(42), bag: { log: 20, stone: 20, workbench: 1 } };
  eq("домик — только у верстака", canCraft(rich, house).ok, false);
  const withBench = place({ ...rich, facing: "down" }, "workbench").state;
  ok("верстак стоит", Object.values(withBench.built).includes("workbench"));
  ok("у верстака домик делается", canCraft(withBench, house).ok);
  const back = pickUp(withBench).state;
  eq("разобрал — вернулся в сумку", [back.bag.workbench, Object.keys(back.built).length], [1, 0]);

  const onTree = faceNature({ ...newVillage(42), bag: { campfire: 1 } }, "tree")!;
  eq("на дерево не поставить", Object.keys(place(onTree, "campfire").state.built).length, 0);
});

test("ночь, еда, задачи", () => {
  const s = { ...newVillage(42), bag: { campfire: 1, berries: 2 }, food: 50 };
  const fire = place({ ...s, facing: "down" }, "campfire").state;
  ok("днём спать рано", act(fire).message!.includes("рано"));
  const night = { ...fire, time: 23 * 60 };
  const slept = act(night).state;
  eq("проснулся в 7 утра следующего дня", slept.time, 24 * 60 + 7 * 60);
  const ate = eat(s, "berries").state;
  ok("поел — сытнее", ate.food > s.food && ate.bag.berries === 1);
  eq("первая задача — ветки", currentGoal(newVillage(42))?.id, "sticks");
  ok("костёр отмечает задачу", fire.goalsDone.includes("campfire"));
});

test("сохранение", () => {
  const s = act(faceNature(newVillage(42), "branch")!).state;
  eq("туда-обратно без потерь", normalizeVillage(JSON.parse(JSON.stringify(s))), s);
  eq("мусор — ничего", normalizeVillage("x"), null);
  eq("без зерна — ничего", normalizeVillage({ time: 5 }), null);
  const odd = normalizeVillage({ seed: 3, bag: { stick: 4, rocket: 1, stone: -2 }, built: { "1:1": "castle", "2:2": "fence" } })!;
  eq("чужие вещи и постройки выброшены", [odd.bag, odd.built], [{ stick: 4 }, { "2:2": "fence" }]);
  const a = { ...newVillage(1), time: 5000 };
  const b = { ...newVillage(2), time: 9000 };
  eq("слияние — где прожито больше", mergeVillage(a, b)?.seed, 2);
  eq("ключ клетки", cellKey(3, 4), "3:4");
});
