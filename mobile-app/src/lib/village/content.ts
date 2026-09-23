/**
 * «Опушка» — всё, из чего состоит мир: вещи, то, что растёт и лежит, постройки, рецепты,
 * задачи.
 *
 * Здесь только справочники, без логики. Так игра и растёт: новая вещь, куст или постройка —
 * это новая строка здесь, а правила в game.ts о них ничего особого знать не должны. Удочка,
 * грядка, торговец — каждый будет добавлен так же.
 *
 * Идентификаторы попадают в сохранение. Переименовать можно подпись, но не `id`: иначе
 * вещи в старых сохранениях станут ничьими.
 */

export type ItemId = "stick" | "stone" | "log" | "berries" | "axe" | "pickaxe" | "campfire" | "workbench" | "fence" | "house";

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Как сказать «+2 …»: одна, две, пять. */
  forms?: [string, string, string];
  /** Инструменты не тратятся: нужен — значит просто должен быть. */
  tool?: boolean;
  /** Сколько сытости даёт, если съесть. */
  food?: number;
  /** Что ставится на землю, если это постройка. */
  places?: StructureId;
  /** Строчка в сумке: зачем эта вещь. */
  hint: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  stick: { id: "stick", name: "Ветка", forms: ["ветка", "ветки", "веток"], hint: "Для инструментов и костра" },
  stone: { id: "stone", name: "Камень", forms: ["камень", "камня", "камней"], hint: "Для инструментов и домика" },
  log: { id: "log", name: "Бревно", forms: ["бревно", "бревна", "брёвен"], hint: "Главный строительный материал" },
  berries: { id: "berries", name: "Ягоды", forms: ["ягода", "ягоды", "ягод"], food: 12, hint: "Съесть — сытость +12" },
  axe: { id: "axe", name: "Топор", tool: true, hint: "Рубит деревья. Не тратится" },
  pickaxe: { id: "pickaxe", name: "Кирка", tool: true, hint: "Разбивает валуны на камни. Не тратится" },
  campfire: { id: "campfire", name: "Костёр", places: "campfire", hint: "Свет ночью, у него можно переночевать" },
  workbench: { id: "workbench", name: "Верстак", places: "workbench", hint: "Рядом с ним делаются забор и домик" },
  fence: { id: "fence", name: "Забор", places: "fence", hint: "Огородить своё место" },
  house: { id: "house", name: "Домик", places: "house", hint: "Свой дом. Ночлег лучше, чем у костра" },
};

/** Что стоит на клетке само по себе: росло или лежало до тебя. */
export type NatureId = "tree" | "bush" | "rock" | "pebble" | "branch";

export interface NatureDef {
  id: NatureId;
  name: string;
  /** Что сделать, чтобы собрать: подпись на кнопке. */
  verb: string;
  /** Без этого инструмента не взять. */
  needs?: ItemId;
  gives: Partial<Record<ItemId, number>>;
  /** Сколько игровых минут занимает. */
  minutes: number;
  /**
   * Через сколько игровых минут вернётся. Мир не должен кончаться: срубленное дерево
   * через несколько дней снова стоит.
   */
  regrow: number;
  /** Что остаётся, пока не вернулось: пень мешает пройти, пустой куст тоже, ветки — нет. */
  leaves: "stump" | "bare" | "nothing";
}

const DAY = 24 * 60;

export const NATURE: Record<NatureId, NatureDef> = {
  tree: { id: "tree", name: "Дерево", verb: "Срубить", needs: "axe", gives: { log: 2, stick: 1 }, minutes: 40, regrow: 3 * DAY, leaves: "stump" },
  bush: { id: "bush", name: "Куст", verb: "Собрать ягоды", gives: { berries: 3 }, minutes: 10, regrow: DAY, leaves: "bare" },
  rock: { id: "rock", name: "Валун", verb: "Разбить", needs: "pickaxe", gives: { stone: 4 }, minutes: 45, regrow: 5 * DAY, leaves: "nothing" },
  pebble: { id: "pebble", name: "Камешки", verb: "Подобрать", gives: { stone: 1 }, minutes: 5, regrow: 2 * DAY, leaves: "nothing" },
  branch: { id: "branch", name: "Ветки", verb: "Подобрать", gives: { stick: 2 }, minutes: 5, regrow: DAY, leaves: "nothing" },
};

export type StructureId = "campfire" | "workbench" | "fence" | "house";

export interface StructureDef {
  id: StructureId;
  name: string;
  /** «у верстака» — для подписи рецепта, которому она нужна. */
  near: string;
  /** Можно ли возле неё переспать ночь. */
  sleep?: "rough" | "cozy";
  /** Рядом с ней открываются рецепты, которым она нужна. */
  station?: boolean;
}

export const STRUCTURES: Record<StructureId, StructureDef> = {
  campfire: { id: "campfire", name: "Костёр", near: "у костра", sleep: "rough" },
  workbench: { id: "workbench", name: "Верстак", near: "у верстака", station: true },
  fence: { id: "fence", name: "Забор", near: "у забора" },
  house: { id: "house", name: "Домик", near: "у домика", sleep: "cozy" },
};

export interface Recipe {
  id: string;
  makes: ItemId;
  count: number;
  needs: Partial<Record<ItemId, number>>;
  /** Делается только рядом с этой постройкой. */
  at?: StructureId;
  minutes: number;
}

export const RECIPES: Recipe[] = [
  { id: "axe", makes: "axe", count: 1, needs: { stick: 3, stone: 2 }, minutes: 20 },
  { id: "pickaxe", makes: "pickaxe", count: 1, needs: { stick: 3, stone: 3 }, minutes: 25 },
  { id: "campfire", makes: "campfire", count: 1, needs: { stick: 5, stone: 3 }, minutes: 20 },
  { id: "workbench", makes: "workbench", count: 1, needs: { log: 4 }, minutes: 30 },
  { id: "fence", makes: "fence", count: 2, needs: { stick: 3 }, at: "workbench", minutes: 10 },
  { id: "house", makes: "house", count: 1, needs: { log: 12, stone: 6 }, at: "workbench", minutes: 120 },
];

/**
 * Задачи — тропинка для начала. Не обязанность: мир открыт и без них, задача только
 * подсказывает, что можно сделать дальше.
 */
export interface Goal {
  id: string;
  title: string;
  hint: string;
}

export const GOALS: Goal[] = [
  { id: "sticks", title: "Собери 5 веток", hint: "Ветки лежат на земле по всему лесу" },
  { id: "axe", title: "Сделай топор", hint: "Нужны 3 ветки и 2 камня — открой «Сумку»" },
  { id: "chop", title: "Сруби дерево", hint: "Встань лицом к дереву и нажми «Срубить»" },
  { id: "campfire", title: "Поставь костёр", hint: "У костра можно переночевать" },
  { id: "workbench", title: "Поставь верстак", hint: "4 бревна. У верстака делаются вещи посложнее" },
  { id: "house", title: "Построй домик", hint: "12 брёвен и 6 камней, делается у верстака" },
];
