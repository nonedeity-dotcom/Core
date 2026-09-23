import type { NatureId } from "./content";

/**
 * Карта «Опушки»: земля и то, что на ней выросло.
 *
 * Карта не хранится — она каждый раз выращивается заново из одного числа, зерна. В
 * сохранение идут только перемены: что срублено, что построено. Так сохранение остаётся
 * маленьким, сколько бы месяцев ни играть, а мир у каждого свой.
 */

export const WORLD_SIZE = 64;

export type Ground = "grass" | "forest" | "shore" | "water";

export interface World {
  seed: number;
  size: number;
  ground: Ground[];
  nature: (NatureId | null)[];
  /** Где начинается игра — середина поляны. */
  start: { x: number; y: number };
}

export type Rnd = () => number;

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

export const cellKey = (x: number, y: number): string => `${x}:${y}`;

/**
 * Постоянное «случайное» число клетки, 0–255. Им выбирается вид дерева, пучки травы,
 * цветы — мелочи, которые делают поляну живой. Одно и то же для клетки всегда, иначе лес
 * переодевался бы на каждом шаге.
 */
export function variant(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) & 255;
}

/**
 * Плавный шум: редкая сетка случайных чисел, между узлами — сглаженная середина. Даёт
 * густые и редкие участки леса вместо ровной ряби.
 */
function valueNoise(rnd: Rnd, size: number, step: number): (x: number, y: number) => number {
  const n = Math.ceil(size / step) + 2;
  const grid = Array.from({ length: n * n }, () => rnd());
  const at = (i: number, j: number) => grid[j * n + i];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / step;
    const gy = y / step;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const tx = smooth(gx - i);
    const ty = smooth(gy - j);
    const top = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const bottom = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

const cache = new Map<number, World>();

export function makeWorld(seed: number): World {
  const cached = cache.get(seed);
  if (cached) return cached;

  const size = WORLD_SIZE;
  const rnd = seeded(seed);
  const density = valueNoise(rnd, size, 8);
  const wet = valueNoise(rnd, size, 11);
  const start = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const dist = (x: number, y: number) => Math.hypot(x - start.x, y - start.y);

  // Пруд: не на поляне, но недалеко — чтобы его нашли в первый же день.
  const angle = rnd() * Math.PI * 2;
  const pond = { x: start.x + Math.round(Math.cos(angle) * 11), y: start.y + Math.round(Math.sin(angle) * 11) };

  const ground: Ground[] = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const d = dist(x, y);
      const toPond = Math.hypot(x - pond.x, y - pond.y) + (wet(x, y) - 0.5) * 3;
      const lake = wet(x, y) > 0.8 && d > 9;
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      if (edge) ground[i] = "forest";
      else if (toPond < 3.2 || lake) ground[i] = "water";
      else ground[i] = d < 7 ? "grass" : density(x, y) > 0.5 ? "forest" : "grass";
    }
  }
  // Берег — сухая земля у самой воды: по ней ходят.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (ground[i] === "water") continue;
      const nearWater = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < size && ny < size && ground[ny * size + nx] === "water";
      });
      if (nearWater) ground[i] = "shore";
    }
  }

  const nature: (NatureId | null)[] = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (ground[i] === "water") continue;
      const d = dist(x, y);
      // Край карты — сплошной лес: за него не выйти, и мир не кончается обрывом.
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) {
        nature[i] = "tree";
        continue;
      }
      if (d < 2) continue;
      const r = rnd();
      const dense = d < 5 ? 0 : density(x, y);
      const treeChance = ground[i] === "forest" ? 0.25 + dense * 0.45 : dense * 0.18;
      if (r < treeChance) nature[i] = "tree";
      else if (r < treeChance + 0.035) nature[i] = "bush";
      else if (r < treeChance + 0.05 && d > 6) nature[i] = "rock";
      else if (r < treeChance + 0.075) nature[i] = "pebble";
      else if (r < treeChance + 0.12) nature[i] = "branch";
    }
  }

  // Поляна обещает начало: рядом всегда есть ветки, камешки и куст — топор делается сразу.
  const near: [number, number, NatureId][] = [
    [2, -1, "branch"],
    [-2, 1, "branch"],
    [1, 3, "branch"],
    [-3, -2, "branch"],
    [3, 2, "pebble"],
    [-1, -3, "pebble"],
    [-3, 3, "pebble"],
    [4, -3, "bush"],
    [-4, 0, "bush"],
  ];
  for (const [dx, dy, id] of near) nature[(start.y + dy) * size + start.x + dx] = id;
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const i = (start.y + dy) * size + start.x + dx;
    nature[i] = null;
    if (ground[i] === "water" || ground[i] === "shore") ground[i] = "grass";
  }

  const world: World = { seed, size, ground, nature, start };
  cache.set(seed, world);
  return world;
}
