/**
 * Откуда взялся продукт или блюдо.
 *
 * Три источника, и человеку они значат разное. Вшитое пришло с приложением и числа там
 * справочные. Отсканированное приехало из открытой базы, куда их вносят такие же люди.
 * Своё он завёл сам — и только за него отвечает.
 *
 * Ничего доразмечать не пришлось: различие уже лежит в самих записях. У всего из базового
 * набора id начинается с `base-` (так его выдаёт `catalog.ts`), у пришедшего со сканера
 * стоит `source`. Остальное — своё. Отдельного поля «происхождение» нет намеренно: поле,
 * которое можно вывести, — это поле, которое однажды разойдётся с правдой.
 */

import type { Dish, FoodProduct } from "./food";
import { OFF_SOURCE } from "./openfoodfacts";

export type Origin = "mine" | "scanned" | "builtin";

/** Значение переключателя: три источника плюс «всё вместе». */
export type OriginFilter = Origin | "all";

export const ORIGIN_FILTERS: OriginFilter[] = ["all", "mine", "scanned", "builtin"];

export const ORIGIN_LABELS: Record<OriginFilter, string> = {
  all: "Все",
  mine: "Мои",
  scanned: "Штрихкод",
  builtin: "Вшитые",
};

/** Префикс id у всего, что пришло из базового набора. */
const BASE_PREFIX = "base-";

export function originOf(item: { id: string; source?: string }): Origin {
  // Источник важнее префикса: продукт со сканера своего `base-` иметь не может, а вот
  // порядок проверок на будущее пусть будет определён.
  if (item.source === OFF_SOURCE) return "scanned";
  return item.id.startsWith(BASE_PREFIX) ? "builtin" : "mine";
}

export function matchesOrigin(item: { id: string; source?: string }, filter: OriginFilter): boolean {
  return filter === "all" || originOf(item) === filter;
}

export interface OriginCounts extends Record<OriginFilter, number> {}

/**
 * Сколько чего — числа стоят прямо на кнопках переключателя.
 *
 * Кнопка без числа заставляет нажимать, чтобы узнать, есть ли там что-нибудь; с числом
 * видно сразу, и пустая группа честно показывает ноль, а не притворяется полной.
 */
export function countByOrigin(items: { id: string; source?: string }[]): OriginCounts {
  const out: OriginCounts = { all: items.length, mine: 0, scanned: 0, builtin: 0 };
  for (const item of items) out[originOf(item)]++;
  return out;
}

/** Что показать в списке при выбранной группе. */
export function filterByOrigin<T extends { id: string; source?: string }>(
  items: T[],
  filter: OriginFilter,
): T[] {
  return filter === "all" ? items : items.filter((i) => originOf(i) === filter);
}

/** Блюда различаются так же — только у них группы всего две: своё и вшитое. */
export const dishOrigin = (dish: Dish): Origin => originOf(dish);
export const productOrigin = (product: FoodProduct): Origin => originOf(product);

/** Пустая группа — не поломка, и объяснить её надо словами, а не пустым местом. */
export const EMPTY_HINT: Record<Origin, { products: string; dishes: string }> = {
  mine: {
    products: "Своих продуктов пока нет. Заведи кнопкой «свой» или отсканируй пачку.",
    dishes: "Своих блюд пока нет. Собери кнопкой «блюдо».",
  },
  scanned: {
    products: "Со штрихкода пока ничего не сохранено. Наведи камеру на пачку.",
    dishes: "Блюдо отсканировать нельзя — у него нет упаковки со штрихкодом.",
  },
  builtin: {
    products: "Базовый набор ещё не добавлен — кнопка внизу экрана.",
    dishes: "Блюда из базового набора ещё не добавлены — кнопка внизу экрана.",
  },
};
