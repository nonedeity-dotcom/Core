import {
  GOALS,
  ITEMS,
  NATURE,
  RECIPES,
  STRUCTURES,
  type ItemId,
  type NatureId,
  type Recipe,
  type StructureId,
} from "./content";
import { WORLD_SIZE, cellKey, makeWorld, type World } from "./world";
import { plural } from "../plural";

/**
 * Правила «Опушки»: одна чистая функция на каждое действие — состояние на входе, новое
 * состояние и строчка о том, что случилось, на выходе. Экран только рисует и зовёт их.
 *
 * Время идёт только от действий. Отложил телефон — мир замер: здесь некуда торопиться, и
 * ничего не случится без тебя.
 */

export type Dir = "up" | "down" | "left" | "right";

export interface VillageState {
  version: 1;
  seed: number;
  /** Игровые минуты с начала. День — 1440. */
  time: number;
  x: number;
  y: number;
  facing: Dir;
  /** Сытость, 0–100. На нуле всё делается вдвое дольше — и только. */
  food: number;
  bag: Partial<Record<ItemId, number>>;
  /** Когда клетку последний раз собрали: ключ "x:y" → игровая минута. */
  used: Record<string, number>;
  /** Что построено: ключ "x:y" → постройка. */
  built: Record<string, StructureId>;
  /** Сколько чего собрано за всё время — для задач и будущей статистики. */
  gathered: Partial<Record<NatureId, number>>;
  goalsDone: string[];
}

export interface Outcome {
  state: VillageState;
  /** Что сказать внизу экрана. null — сказать нечего (просто шаг). */
  message: string | null;
  /** Каким звуком это отозвалось. Нет — тишина. */
  sound?: SoundId;
  /** Выполнена задача — поверх обычного звука играет короткая мелодия. */
  goal?: boolean;
}

/**
 * Звуки мира. Правила говорят, что случилось, а экран решает, играть ли вообще (звук можно
 * выключить в настройках), — поэтому здесь только название, без файлов.
 */
export type SoundId =
  | "step"
  | "twig"
  | "pebble"
  | "chop"
  | "stone"
  | "berries"
  | "water"
  | "eat"
  | "craft"
  | "place"
  | "pickup"
  | "sleep"
  | "goal"
  | "nope"
  | "ui"
  | "bag";

const GATHER_SOUND: Record<NatureId, SoundId> = {
  tree: "chop",
  bush: "berries",
  rock: "stone",
  pebble: "pebble",
  branch: "twig",
};

export const DAY_MINUTES = 24 * 60;
/** Первый день начинается утром, а не в полночь. */
const START_TIME = 8 * 60;
const STEP_MINUTES = 2;
const FOOD_PER_MINUTE = 1 / 15;

export function newVillage(seed: number): VillageState {
  const world = makeWorld(seed);
  return {
    version: 1,
    seed,
    time: START_TIME,
    x: world.start.x,
    y: world.start.y,
    facing: "down",
    food: 80,
    bag: {},
    used: {},
    built: {},
    gathered: {},
    goalsDone: [],
  };
}

// --- время ------------------------------------------------------------------------

export const dayOf = (time: number): number => Math.floor(time / DAY_MINUTES) + 1;
export const hourOf = (time: number): number => Math.floor((time % DAY_MINUTES) / 60);
export const clockOf = (time: number): string => {
  const m = time % DAY_MINUTES;
  return `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
};
export const isNight = (time: number): boolean => {
  const h = hourOf(time);
  return h >= 21 || h < 6;
};
/** Насколько темно, 0–1: сумерки с 19 до 21 и рассвет с 5 до 7 плавные. */
export function darkness(time: number): number {
  const h = (time % DAY_MINUTES) / 60;
  if (h >= 21 || h < 5) return 1;
  if (h >= 19) return (h - 19) / 2;
  if (h < 7) return 1 - (h - 5) / 2;
  return 0;
}

/** Прошло время — стало чуть голоднее. */
function pass(state: VillageState, minutes: number): VillageState {
  return { ...state, time: state.time + minutes, food: Math.max(0, state.food - minutes * FOOD_PER_MINUTE) };
}

// --- что на клетке ----------------------------------------------------------------

export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < WORLD_SIZE && y < WORLD_SIZE;

export interface CellView {
  ground: World["ground"][number];
  nature: NatureId | null;
  /** Собрано и ещё не выросло: пень, пустой куст. */
  depleted: boolean;
  built: StructureId | null;
}

export function cellAt(state: VillageState, x: number, y: number): CellView | null {
  if (!inBounds(x, y)) return null;
  const world = makeWorld(state.seed);
  const i = y * world.size + x;
  const key = cellKey(x, y);
  const built = state.built[key] ?? null;
  // Под постройкой ничего не растёт — иначе через день из-под костра вылезли бы ветки.
  const nature = built ? null : world.nature[i];
  const usedAt = state.used[key];
  const depleted = nature !== null && usedAt !== undefined && state.time - usedAt < NATURE[nature].regrow;
  return { ground: world.ground[i], nature, depleted, built };
}

export function walkable(state: VillageState, x: number, y: number): boolean {
  const c = cellAt(state, x, y);
  if (!c || c.ground === "water" || c.built) return false;
  if (!c.nature) return true;
  if (!c.depleted) return c.nature === "branch" || c.nature === "pebble";
  return NATURE[c.nature].leaves === "nothing";
}

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function facingCell(state: VillageState): { x: number; y: number } {
  const [dx, dy] = DELTA[state.facing];
  return { x: state.x + dx, y: state.y + dy };
}

/**
 * Дорога до клетки, по которой нажали: список шагов.
 *
 * Если на клетке что-то стоит (дерево, костёр), дорога ведёт к соседней свободной и
 * кончается поворотом лицом к цели — шаг в занятую клетку только поворачивает. Поиск в
 * ширину: мир маленький, 64×64, и самая короткая дорога находится мгновенно. null — не
 * дойти (цель за водой или в чаще).
 */
export function pathTo(state: VillageState, tx: number, ty: number): Dir[] | null {
  if (!inBounds(tx, ty) || (tx === state.x && ty === state.y)) return null;
  const goalFree = walkable(state, tx, ty);
  const dirs = Object.entries(DELTA) as [Dir, [number, number]][];
  // Куда нужно прийти: на саму клетку, если на неё можно встать, иначе — рядом с ней.
  const ends = new Map<string, Dir | null>();
  if (goalFree) ends.set(cellKey(tx, ty), null);
  else {
    for (const [dir, [dx, dy]] of dirs) {
      // Стоя на (tx-dx, ty-dy), к цели поворачиваются в сторону dir.
      const sx = tx - dx;
      const sy = ty - dy;
      if ((sx === state.x && sy === state.y) || walkable(state, sx, sy)) ends.set(cellKey(sx, sy), dir);
    }
  }
  if (ends.size === 0) return null;

  const start = cellKey(state.x, state.y);
  const prev = new Map<string, [string, Dir] | null>([[start, null]]);
  const queue: [number, number][] = [[state.x, state.y]];
  let found: string | null = ends.has(start) ? start : null;
  while (queue.length > 0 && found === null) {
    const [x, y] = queue.shift()!;
    for (const [dir, [dx, dy]] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const k = cellKey(nx, ny);
      if (prev.has(k) || !walkable(state, nx, ny)) continue;
      prev.set(k, [cellKey(x, y), dir]);
      if (ends.has(k)) {
        found = k;
        break;
      }
      queue.push([nx, ny]);
    }
  }
  if (found === null) return null;

  const steps: Dir[] = [];
  for (let k = found; prev.get(k); k = prev.get(k)![0]) steps.unshift(prev.get(k)![1]);
  const turn = ends.get(found);
  if (turn) steps.push(turn);
  return steps;
}

/** К чему повернулся персонаж — чтобы нарисовать на кнопке действия его значок. */
export type ActionIcon = ItemId | "sleep" | "water" | null;

export function actionIcon(state: VillageState): ActionIcon {
  const { x, y } = facingCell(state);
  const c = cellAt(state, x, y);
  if (!c) return null;
  if (c.built) {
    const s = STRUCTURES[c.built];
    if (s.sleep && isNight(state.time)) return "sleep";
    return (Object.values(ITEMS).find((i) => i.places === c.built)?.id ?? null) as ItemId | null;
  }
  if (c.nature && !c.depleted) {
    const def = NATURE[c.nature];
    return def.needs ?? ((Object.keys(def.gives)[0] as ItemId | undefined) ?? null);
  }
  if (c.ground === "water") return "water";
  return null;
}

// --- действия ---------------------------------------------------------------------

/**
 * Шаг. Если впереди что-то стоит, персонаж только поворачивается к этому — так к дереву
 * подходят и встают к нему лицом одной и той же кнопкой.
 *
 * Ветки и камешки подбираются сами, когда на них наступаешь: останавливаться и
 * поворачиваться к тому, что лежит под ногами, — лишнее движение.
 */
export function move(state: VillageState, dir: Dir): Outcome {
  const [dx, dy] = DELTA[dir];
  const turned = { ...state, facing: dir };
  const x = state.x + dx;
  const y = state.y + dy;
  if (!walkable(state, x, y)) return { state: turned, message: null };
  const stepped = pass({ ...turned, x, y }, STEP_MINUTES);
  const c = cellAt(stepped, x, y);
  if (c?.nature && !c.depleted && (c.nature === "branch" || c.nature === "pebble")) return gather(stepped, x, y, c.nature);
  return { state: stepped, message: null, sound: "step" };
}

/** Что сделает кнопка действия прямо сейчас — подпись для неё. null — делать нечего. */
export function actionLabel(state: VillageState): string | null {
  const { x, y } = facingCell(state);
  const c = cellAt(state, x, y);
  if (!c) return null;
  if (c.built) {
    const s = STRUCTURES[c.built];
    if (s.sleep) return isNight(state.time) ? "Спать" : s.name;
    return s.name;
  }
  if (c.nature && !c.depleted) return NATURE[c.nature].verb;
  if (c.ground === "water") return "Вода";
  return null;
}

const addTo = (bag: VillageState["bag"], gives: Partial<Record<ItemId, number>>) => {
  const next = { ...bag };
  for (const [id, n] of Object.entries(gives) as [ItemId, number][]) next[id] = (next[id] ?? 0) + n;
  return next;
};

const describe = (gives: Partial<Record<ItemId, number>>) =>
  (Object.entries(gives) as [ItemId, number][])
    .map(([id, n]) => `+${n} ${ITEMS[id].forms ? plural(n, ITEMS[id].forms!) : ITEMS[id].name.toLowerCase()}`)
    .join(", ");

/** Кнопка действия: собрать, срубить, переспать у костра. */
export function act(state: VillageState): Outcome {
  const { x, y } = facingCell(state);
  const c = cellAt(state, x, y);
  if (!c) return { state, message: null };

  if (c.built) {
    const s = STRUCTURES[c.built];
    if (s.sleep) return sleep(state, s.sleep);
    if (s.station) return { state, message: `${s.name} рядом — в «Сумке» открылись новые рецепты`, sound: "ui" };
    return { state, message: s.name, sound: "ui" };
  }

  if (c.ground === "water" && !c.nature) return { state, message: "Тихая вода. Когда-нибудь здесь будет удочка", sound: "water" };
  if (!c.nature) return { state, message: null };

  const def = NATURE[c.nature];
  if (c.depleted) {
    return { state, message: def.leaves === "stump" ? "Пень. Дерево отрастёт через пару дней" : `${def.name}: ещё не выросло`, sound: "nope" };
  }
  if (def.needs && !state.bag[def.needs]) {
    return { state, message: `Нужен инструмент: ${ITEMS[def.needs].name.toLowerCase()}`, sound: "nope" };
  }

  return gather(state, x, y, c.nature);
}

function gather(state: VillageState, x: number, y: number, id: NatureId): Outcome {
  const def = NATURE[id];
  // Голодному всё даётся вдвое дольше. Не наказание — просто повод поесть.
  const minutes = state.food <= 0 ? def.minutes * 2 : def.minutes;
  const next = pass(
    {
      ...state,
      bag: addTo(state.bag, def.gives),
      used: { ...state.used, [cellKey(x, y)]: state.time },
      gathered: { ...state.gathered, [def.id]: (state.gathered[def.id] ?? 0) + 1 },
    },
    minutes,
  );
  return withGoals(next, describe(def.gives), GATHER_SOUND[id]);
}

function sleep(state: VillageState, kind: "rough" | "cozy"): Outcome {
  if (!isNight(state.time)) return { state, message: "Спать ещё рано — ночь начнётся в 21:00", sound: "nope" };
  const dayStart = state.time - (state.time % DAY_MINUTES);
  const morning = hourOf(state.time) >= 21 ? dayStart + DAY_MINUTES + 7 * 60 : dayStart + 7 * 60;
  // Во сне голод идёт медленнее — иначе после каждой ночи просыпался бы пустым.
  const slept = { ...state, time: morning, food: Math.max(0, state.food - 10) };
  return { state: slept, message: kind === "cozy" ? "Выспался в домике. Доброе утро" : "Переночевал у костра. Утро", sound: "sleep" };
}

export function eat(state: VillageState, id: ItemId): Outcome {
  const food = ITEMS[id].food;
  if (!food || !state.bag[id]) return { state, message: null };
  const bag = { ...state.bag, [id]: (state.bag[id] ?? 0) - 1 };
  return {
    state: pass({ ...state, bag, food: Math.min(100, state.food + food) }, 2),
    message: `Съел: ${ITEMS[id].name.toLowerCase()}`,
    sound: "eat",
  };
}

/** Стоит ли рядом (в соседней клетке, включая углы) такая постройка. */
export function near(state: VillageState, structure: StructureId): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (state.built[cellKey(state.x + dx, state.y + dy)] === structure) return true;
    }
  }
  return false;
}

export type CraftCheck = { ok: true } | { ok: false; reason: string };

export function canCraft(state: VillageState, recipe: Recipe): CraftCheck {
  if (recipe.at && !near(state, recipe.at)) return { ok: false, reason: `Нужно стоять у: ${STRUCTURES[recipe.at].name.toLowerCase()}` };
  for (const [id, n] of Object.entries(recipe.needs) as [ItemId, number][]) {
    if ((state.bag[id] ?? 0) < n) return { ok: false, reason: "Не хватает" };
  }
  if (ITEMS[recipe.makes].tool && state.bag[recipe.makes]) return { ok: false, reason: "Уже есть" };
  return { ok: true };
}

export function craft(state: VillageState, recipeId: string): Outcome {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return { state, message: null };
  const check = canCraft(state, recipe);
  if (check.ok === false) return { state, message: check.reason, sound: "nope" };
  const bag = { ...state.bag };
  for (const [id, n] of Object.entries(recipe.needs) as [ItemId, number][]) bag[id] = (bag[id] ?? 0) - n;
  bag[recipe.makes] = (bag[recipe.makes] ?? 0) + recipe.count;
  return withGoals(pass({ ...state, bag }, recipe.minutes), `Сделано: ${ITEMS[recipe.makes].name.toLowerCase()}`, "craft");
}

/** Поставить постройку из сумки на клетку перед собой. */
export function place(state: VillageState, id: ItemId): Outcome {
  const structure = ITEMS[id].places;
  if (!structure || !state.bag[id]) return { state, message: null };
  const { x, y } = facingCell(state);
  const c = cellAt(state, x, y);
  if (!c || !walkable(state, x, y) || (c.nature && !c.depleted)) {
    return { state, message: "Здесь не поставить — встань лицом к свободной земле", sound: "nope" };
  }
  const bag = { ...state.bag, [id]: (state.bag[id] ?? 0) - 1 };
  const next = pass({ ...state, bag, built: { ...state.built, [cellKey(x, y)]: structure } }, 15);
  return withGoals(next, `Поставлено: ${STRUCTURES[structure].name.toLowerCase()}`, "place");
}

/** Разобрать постройку перед собой — она вернётся в сумку целиком. */
export function pickUp(state: VillageState): Outcome {
  const { x, y } = facingCell(state);
  const key = cellKey(x, y);
  const structure = state.built[key];
  if (!structure) return { state, message: null };
  const built = { ...state.built };
  delete built[key];
  const item = (Object.values(ITEMS).find((i) => i.places === structure)?.id ?? structure) as ItemId;
  return {
    state: pass({ ...state, built, bag: addTo(state.bag, { [item]: 1 }) }, 10),
    message: `Разобрано: ${STRUCTURES[structure].name.toLowerCase()}`,
    sound: "pickup",
  };
}

// --- задачи -----------------------------------------------------------------------

const has = (state: VillageState, s: StructureId) => Object.values(state.built).includes(s);

const GOAL_CHECK: Record<string, (s: VillageState) => boolean> = {
  sticks: (s) => (s.bag.stick ?? 0) >= 5 || (s.gathered.branch ?? 0) >= 3,
  axe: (s) => (s.bag.axe ?? 0) > 0,
  chop: (s) => (s.gathered.tree ?? 0) > 0,
  campfire: (s) => has(s, "campfire"),
  workbench: (s) => has(s, "workbench"),
  house: (s) => has(s, "house"),
};

/** Отметить выполненные задачи. Выполненная остаётся выполненной, даже если костёр потом убрали. */
function withGoals(state: VillageState, message: string, sound: SoundId): Outcome {
  const fresh = GOALS.filter((g) => !state.goalsDone.includes(g.id) && GOAL_CHECK[g.id]?.(state));
  if (fresh.length === 0) return { state, message, sound };
  return {
    state: { ...state, goalsDone: [...state.goalsDone, ...fresh.map((g) => g.id)] },
    message: `${message} · Задача выполнена: ${fresh[fresh.length - 1].title.toLowerCase()}`,
    sound,
    goal: true,
  };
}

export const currentGoal = (state: VillageState) => GOALS.find((g) => !state.goalsDone.includes(g.id)) ?? null;

// --- сохранение -------------------------------------------------------------------

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Сохранение, прочитанное из хранилища или резервной копии. Непонятное выбрасывается
 * по кусочку: сломанная запись о пне не должна стоить всей деревни.
 */
export function normalizeVillage(raw: unknown): VillageState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const seed = num(o.seed, NaN);
  if (!Number.isInteger(seed)) return null;
  const base = newVillage(seed);
  const dirs: Dir[] = ["up", "down", "left", "right"];
  const record = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> => {
    const out: Record<string, T> = {};
    if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) if (ok(x)) out[k] = x;
    return out;
  };
  const isCount = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
  const bag = record(o.bag, isCount) as VillageState["bag"];
  for (const k of Object.keys(bag)) if (!(k in ITEMS)) delete (bag as Record<string, number>)[k];
  const built = record(o.built, (x): x is StructureId => typeof x === "string" && x in STRUCTURES);
  const gathered = record(o.gathered, isCount) as VillageState["gathered"];
  const x = num(o.x, base.x);
  const y = num(o.y, base.y);
  return {
    version: 1,
    seed,
    time: Math.max(0, num(o.time, base.time)),
    x: inBounds(x, y) ? x : base.x,
    y: inBounds(x, y) ? y : base.y,
    facing: dirs.includes(o.facing as Dir) ? (o.facing as Dir) : "down",
    food: Math.min(100, Math.max(0, num(o.food, base.food))),
    bag,
    used: record(o.used, (v): v is number => typeof v === "number" && Number.isFinite(v)),
    built,
    gathered,
    goalsDone: Array.isArray(o.goalsDone) ? o.goalsDone.filter((g): g is string => typeof g === "string") : [],
  };
}

/** Две копии одной игры: права та, в которой прожито больше. Смешивать миры нельзя. */
export const mergeVillage = (a: VillageState | null, b: VillageState | null): VillageState | null =>
  !a ? b : !b ? a : b.time > a.time ? b : a;
