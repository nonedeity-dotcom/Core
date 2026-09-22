import { WORD_COLORS } from "../games/wordsearch";
import type { Currency } from "./currency";

/**
 * Что продаётся и что даётся за дело.
 *
 * Разделение простое и держится на том, чем валюты отличаются. За искры — расходное:
 * подсказка в игре, новое поле. За ядра — то, что остаётся навсегда: наборы цветов, темы,
 * титулы. Искры копятся сами собой, ядра — неделями, и цены это отражают.
 *
 * Здесь только данные. Ни экранов, ни хранилища: чтобы добавить товар, правится один
 * список, а не три файла.
 */

export type ItemKind = "fieldPalette" | "accent" | "title";

export interface ShopItem {
  id: string;
  kind: ItemKind;
  title: string;
  hint: string;
  cores: number;
  /** Цвета набора — для предпросмотра и для самого применения. */
  colors?: string[];
  /** Один цвет — для акцента приложения. */
  color?: string;
}

/**
 * Наборы цветов для найденных слов в игре.
 *
 * Первый — тот, что был всегда, и он бесплатный: покупка не должна быть условием, чтобы
 * игра выглядела нормально.
 */
export const FIELD_PALETTES: ShopItem[] = [
  {
    id: "palette-default",
    kind: "fieldPalette",
    title: "Обычный",
    hint: "Тот, с которым игра и родилась",
    cores: 0,
    // Не копия, а он самый: второй список тех же шести цветов разъехался бы с первым.
    colors: WORD_COLORS,
  },
  {
    id: "palette-ember",
    kind: "fieldPalette",
    title: "Угли",
    hint: "Тёплый, от красного к жёлтому",
    cores: 8,
    colors: ["#e0654f", "#e08a55", "#d99b4e", "#d6b64c", "#c9744a", "#b8563f"],
  },
  {
    id: "palette-deep",
    kind: "fieldPalette",
    title: "Глубина",
    hint: "Холодный, от синего к бирюзовому",
    cores: 8,
    colors: ["#4a72c4", "#5c8fd6", "#5aa8c9", "#6fc3c0", "#7f8fd6", "#4fb39a"],
  },
  {
    id: "palette-moss",
    kind: "fieldPalette",
    title: "Мох",
    hint: "Зелёный во всех оттенках",
    cores: 8,
    colors: ["#6f9f7f", "#8fb89a", "#9dc47a", "#7bbf9e", "#5f9a6b", "#a8c98c"],
  },
];

/**
 * Акцентный цвет приложения.
 *
 * Про него в магазине сказано прямо: подействует со следующего запуска. Цвета в приложении
 * запоминаются стилями в момент загрузки экрана, и поменять их на лету, не переписав
 * восемьдесят мест в двадцати девяти файлах, нельзя. Обещать мгновенную смену и не сделать
 * её — хуже, чем честно предупредить.
 */
export const ACCENTS: ShopItem[] = [
  { id: "accent-default", kind: "accent", title: "Тёплый", hint: "Родной цвет приложения", cores: 0, color: "#e08a55" },
  { id: "accent-berry", kind: "accent", title: "Ягодный", hint: "Тёмно-розовый", cores: 6, color: "#d1668a" },
  { id: "accent-sky", kind: "accent", title: "Небо", hint: "Спокойный синий", cores: 6, color: "#5c8fd6" },
  { id: "accent-lime", kind: "accent", title: "Лайм", hint: "Резкий зелёный", cores: 6, color: "#93c25b" },
  { id: "accent-violet", kind: "accent", title: "Фиалка", hint: "Приглушённый фиолетовый", cores: 6, color: "#a87ccc" },
];

/** Титулы, которые можно купить. Чистое украшение — за ними ничего не стоит, и это честно. */
export const BUYABLE_TITLES: ShopItem[] = [
  { id: "title-owl", kind: "title", title: "Сова", hint: "Просто нравится", cores: 4 },
  { id: "title-stone", kind: "title", title: "Камень", hint: "Просто нравится", cores: 4 },
  { id: "title-keeper", kind: "title", title: "Хранитель", hint: "Звучит солидно", cores: 8 },
  { id: "title-quiet", kind: "title", title: "Тихий час", hint: "Звучит спокойно", cores: 8 },
  { id: "title-ironside", kind: "title", title: "Железнобокий", hint: "Дорогой и без повода", cores: 20 },
];

export const SHOP_ITEMS: ShopItem[] = [...FIELD_PALETTES, ...ACCENTS, ...BUYABLE_TITLES];

export const itemById = (id: string): ShopItem | null => SHOP_ITEMS.find((i) => i.id === id) ?? null;

/** Бесплатное считается своим с самого начала — покупать «обычный цвет» абсурдно. */
export const isOwned = (owned: string[], item: ShopItem): boolean => item.cores === 0 || owned.includes(item.id);

/**
 * Титул за дело.
 *
 * Купить нельзя, и в этом весь смысл: за ним стоит то, что действительно случилось. Условие
 * читается из того же состояния, по которому начисляются монеты, поэтому и выдаётся он сам
 * собой — в том числе задним числом за всё, что уже было.
 */
export interface EarnedTitle {
  id: string;
  title: string;
  hint: string;
}

export interface TitleState {
  bestStreak: number;
  closedDays: number;
  summaries: number;
  goalsDone: number;
  fields: number;
  hardFields: number;
}

/**
 * Правило титула: чем меряется и сколько нужно.
 *
 * Мера и порог лежат отдельно, а не спрятаны внутри «достигнуто или нет». Из-за этого
 * запертый титул умеет сказать, сколько осталось, — а список того, чего у тебя нет, без
 * этого числа только и делает, что перечисляет.
 */
export interface TitleRule {
  id: string;
  title: string;
  hint: string;
  /** Сколько нужно. */
  need: number;
  /** Сколько есть сейчас. */
  have: (s: TitleState) => number;
}

export const TITLE_RULES: TitleRule[] = [
  { id: "t-week", title: "Неделя", hint: "7 дней подряд", need: 7, have: (s) => s.bestStreak },
  { id: "t-month", title: "Месяц", hint: "30 дней подряд", need: 30, have: (s) => s.bestStreak },
  {
    id: "t-autopilot",
    title: "Автопилот",
    hint: "66 дней подряд — привычка держится сама",
    need: 66,
    have: (s) => s.bestStreak,
  },
  {
    id: "t-hundred",
    title: "Сотня",
    hint: "100 закрытых дней за всё время",
    need: 100,
    have: (s) => s.closedDays,
  },
  { id: "t-chronicler", title: "Летописец", hint: "3 написанных итога месяца", need: 3, have: (s) => s.summaries },
  { id: "t-finisher", title: "Доводящий", hint: "Цель месяца закрыта целиком", need: 1, have: (s) => s.goalsDone },
  { id: "t-seeker", title: "Искатель", hint: "50 собранных полей", need: 50, have: (s) => s.fields },
  { id: "t-untangler", title: "Распутыватель", hint: "10 полей на сложном", need: 10, have: (s) => s.hardFields },
];

/** Сколько есть и сколько нужно. Больше порога не показывается: «120 из 100» — это не счёт. */
export const titleProgress = (rule: TitleRule, state: TitleState): { have: number; need: number } => ({
  have: Math.min(rule.have(state), rule.need),
  need: rule.need,
});

export const titleReached = (rule: TitleRule, state: TitleState): boolean => rule.have(state) >= rule.need;

export function earnedTitles(state: TitleState): EarnedTitle[] {
  return TITLE_RULES.filter((r) => titleReached(r, state)).map(({ id, title, hint }) => ({ id, title, hint }));
}

/**
 * Ближайший незаработанный титул.
 *
 * Тот, до которого меньше всего осталось в долях, а не в штуках: «две сотых до сотни дней»
 * ближе, чем «половина до трёх итогов», хотя в штуках наоборот.
 */
export function nextTitle(state: TitleState): { rule: TitleRule; have: number; need: number } | null {
  const left = TITLE_RULES.filter((r) => !titleReached(r, state)).map((rule) => ({
    rule,
    ...titleProgress(rule, state),
  }));
  if (left.length === 0) return null;
  return left.sort((a, b) => b.have / b.need - a.have / a.need)[0];
}

/** Цена словами — в магазине она всегда в ядрах, но пусть это будет сказано в одном месте. */
export const priceOf = (item: ShopItem): { cores: number } => ({ cores: item.cores });

export const CURRENCY_LABELS: Record<Currency, [string, string, string]> = {
  sparks: ["искра", "искры", "искр"],
  cores: ["ядро", "ядра", "ядер"],
};

/**
 * Цена подсказок — они расходные и потому за искры.
 *
 * И то, и другое стоит ещё кое-чего сверх искр: партия с подсказкой не идёт в рекорд.
 * Иначе лучшее время покупалось бы за накопленное, а рекорд, который можно купить, ничего
 * не значит. Само поле при этом засчитывается — собрал так собрал.
 */
export const HINT_PRICES = {
  /** Открыть одну букву ещё не найденного слова. */
  letter: 30,
  /** Засчитать целиком одно ещё не найденное слово. */
  word: 80,
};

/** Цвета набора по идентификатору. Неизвестный или снятый набор — тот, что был всегда. */
export const paletteColors = (id: string): string[] =>
  (FIELD_PALETTES.find((p) => p.id === id) ?? FIELD_PALETTES[0]).colors as string[];

/** Акцент по идентификатору. Та же оговорка про неизвестный. */
export const accentColor = (id: string): string =>
  (ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]).color as string;

/** Название титула по идентификатору — и купленного, и заработанного. */
export const titleName = (id: string): string =>
  BUYABLE_TITLES.find((t) => t.id === id)?.title ?? TITLE_RULES.find((t) => t.id === id)?.title ?? "";
