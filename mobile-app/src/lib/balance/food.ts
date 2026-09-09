/**
 * Еда: продукты, съеденное за день и вся арифметика вокруг них.
 *
 * Ключевое решение здесь одно: **запись в дневнике хранит числа, а не ссылку на продукт**.
 * Название и БЖУ копируются в неё в момент добавления. Продукт потом можно переименовать,
 * поправить в нём калорийность или удалить совсем — вчерашний обед от этого не изменится.
 * Дневник — это запись того, что было, а не отчёт, который пересчитывается задним числом.
 */

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";

export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
};

/** Питательность на 100 г — то, в чём продукты и задаются, и сравниваются. */
export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
}

export const ZERO: Nutrition = { kcal: 0, protein: 0, fat: 0, carb: 0 };

export interface FoodProduct extends Nutrition {
  id: string;
  name: string;
  /**
   * Сколько граммов в одной порции. Без него доступны только граммы: «2 порции» без
   * веса порции — это не количество, а надежда.
   */
  portionG?: number;
  /** Когда его последний раз добавляли — по этому строится «Часто ем». */
  lastUsedAt?: string;
}

export interface FoodEntry extends Nutrition {
  id: string;
  date: string;
  meal: Meal;
  /** Откуда взято — только чтобы посчитать «часто ем»; числа ниже уже свои. */
  productId: string;
  /** Заполнено, если добавляли блюдо целиком, а не отдельный продукт. */
  dishId?: string;
  name: string;
  grams: number;
}

/** Один продукт внутри блюда и его вес в этом блюде. */
export interface DishItem {
  productId: string;
  grams: number;
}

/**
 * Блюдо — сохранённый набор продуктов, который добавляется одной кнопкой.
 *
 * Хранит ссылки на продукты, а не их числа: блюдо это рецепт, и если поправить в твороге
 * калорийность, то и завтрашняя запеканка должна считаться по новой. Запись в дневнике при
 * этом останется прежней — она числа уже скопировала. Разница ровно та, что нужна: рецепт
 * живёт, съеденное не переписывается.
 */
export interface Dish {
  id: string;
  name: string;
  items: DishItem[];
  lastUsedAt?: string;
}

/** Сколько продуктов помнит «Часто ем». */
export const RECENT_LIMIT = 20;

/**
 * Округление, которое не съезжает на половинках.
 *
 * `Math.round(2.85 * 10) / 10` даёт 2.8, потому что 2.85 в двоичной записи чуть меньше
 * себя. Для одного числа это незаметно, но здесь из таких чисел складывается день, и
 * «съел на 3 грамма белка меньше, чем показано в строках» — плохой способ узнать о
 * плавающей точке.
 */
const round = (value: number, digits = 0): number => {
  const k = 10 ** digits;
  return Math.round(value * k + 1e-9) / k;
};

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : fallback;

const isStr = (v: unknown): v is string => typeof v === "string";

export function normalizeProduct(value: unknown): FoodProduct | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isStr(v.id) || !isStr(v.name) || v.name.trim() === "") return null;
  const portion = num(v.portionG, 0);
  return {
    id: v.id,
    name: v.name.trim(),
    kcal: round(num(v.kcal)),
    protein: round(num(v.protein), 1),
    fat: round(num(v.fat), 1),
    carb: round(num(v.carb), 1),
    ...(portion > 0 ? { portionG: Math.round(portion) } : {}),
    ...(isStr(v.lastUsedAt) ? { lastUsedAt: v.lastUsedAt } : {}),
  };
}

export function normalizeEntry(value: unknown): FoodEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isStr(v.id) || !isStr(v.date) || !isStr(v.name)) return null;
  return {
    id: v.id,
    date: v.date,
    meal: MEALS.includes(v.meal as Meal) ? (v.meal as Meal) : "snack",
    productId: isStr(v.productId) ? v.productId : "",
    name: v.name,
    grams: round(num(v.grams)),
    kcal: round(num(v.kcal)),
    protein: round(num(v.protein), 1),
    fat: round(num(v.fat), 1),
    carb: round(num(v.carb), 1),
  };
}

export function normalizeDish(value: unknown): Dish | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isStr(v.id) || !isStr(v.name) || v.name.trim() === "") return null;
  const items = (Array.isArray(v.items) ? v.items : [])
    .map((raw) => {
      if (typeof raw !== "object" || raw === null) return null;
      const i = raw as Record<string, unknown>;
      const grams = round(num(i.grams));
      // Пустой productId — это не продукт, а дырка: он никогда ни к чему не привяжется и
      // будет вечно считаться потерянным составом. Такой пункт выбрасывается здесь.
      return isStr(i.productId) && i.productId !== "" && grams > 0 ? { productId: i.productId, grams } : null;
    })
    .filter((i): i is DishItem => i !== null);
  return {
    id: v.id,
    name: v.name.trim(),
    items,
    ...(isStr(v.lastUsedAt) ? { lastUsedAt: v.lastUsedAt } : {}),
  };
}

/**
 * Что получится, если съесть `grams` этого продукта.
 *
 * Округляется здесь, один раз, при добавлении — а не при каждом показе. Иначе сумма за день
 * не сходилась бы с тем, что написано в строках: три записи по 0.4 г белка показывались бы
 * как «0», а в сумме давали бы 1.2.
 */
export function nutritionFor(product: Nutrition, grams: number): Nutrition {
  const k = Math.max(0, grams) / 100;
  return {
    kcal: round(product.kcal * k),
    protein: round(product.protein * k, 1),
    fat: round(product.fat * k, 1),
    carb: round(product.carb * k, 1),
  };
}

/** Сумма — то, из чего складывается день и любой приём пищи внутри него. */
export function sumNutrition(items: Nutrition[]): Nutrition {
  return items.reduce<Nutrition>(
    (acc, n) => ({
      kcal: acc.kcal + n.kcal,
      protein: round(acc.protein + n.protein, 1),
      fat: round(acc.fat + n.fat, 1),
      carb: round(acc.carb + n.carb, 1),
    }),
    { ...ZERO },
  );
}

export function entriesForDay(entries: FoodEntry[], date: string): FoodEntry[] {
  return entries.filter((e) => e.date === date);
}

export function entriesForMeal(entries: FoodEntry[], date: string, meal: Meal): FoodEntry[] {
  return entries.filter((e) => e.date === date && e.meal === meal);
}

/**
 * «Часто ем» — последние двадцать, а не самые частые.
 *
 * Заказано было именно так, и это правильнее для одного тапа: то, что ты ел вчера, с куда
 * большей вероятностью окажется в тарелке сегодня, чем то, что ты ел двадцать раз прошлой
 * зимой. Продукты, которых ещё ни разу не добавляли, сюда не попадают.
 */
export function recentProducts(products: FoodProduct[], limit = RECENT_LIMIT): FoodProduct[] {
  return products
    .filter((p) => !!p.lastUsedAt)
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .slice(0, limit);
}

/**
 * Поиск по своим продуктам.
 *
 * Простое вхождение подстроки без учёта регистра: список свой и короткий, а нечёткий поиск
 * на два десятка названий чаще мешает, чем помогает — «рис» не должен находить «редис».
 */
export function searchProducts(products: FoodProduct[], query: string): FoodProduct[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...products].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return products
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      // Совпадение с начала названия важнее совпадения где-то в середине.
      const ai = a.name.toLowerCase().indexOf(q);
      const bi = b.name.toLowerCase().indexOf(q);
      return ai !== bi ? ai - bi : a.name.localeCompare(b.name, "ru");
    });
}

/** Граммы из порций и обратно — обе стороны, чтобы поле можно было переключать. */
export function gramsFromPortions(product: FoodProduct, portions: number): number {
  return Math.round(Math.max(0, portions) * (product.portionG ?? 0));
}

export function portionsFromGrams(product: FoodProduct, grams: number): number {
  const portion = product.portionG ?? 0;
  return portion > 0 ? round(grams / portion, 1) : 0;
}

/** Сколько осталось до нормы. Отрицательное — это перебор, и так и должно читаться. */
export function remaining(target: number, eaten: number): number {
  return Math.round(target - eaten);
}


export interface DishTotals extends Nutrition {
  grams: number;
  /** Сколько продуктов блюда не нашлось — их удалили из списка после того, как собрали блюдо. */
  missing: number;
}

/**
 * Во что складывается блюдо по текущим продуктам.
 *
 * Удалённый продукт не обнуляет блюдо и не притворяется нулём: он просто не участвует, а
 * `missing` позволяет сказать об этом вслух. Молча посчитать запеканку без творога — это
 * то же самое, что соврать.
 */
export function dishTotals(dish: Dish, products: FoodProduct[]): DishTotals {
  const byId = new Map(products.map((p) => [p.id, p]));
  let grams = 0;
  let missing = 0;
  const parts: Nutrition[] = [];
  for (const item of dish.items) {
    const product = byId.get(item.productId);
    if (!product) {
      missing++;
      continue;
    }
    grams += item.grams;
    parts.push(nutritionFor(product, item.grams));
  }
  return { ...sumNutrition(parts), grams: round(grams), missing };
}

/** Последние использованные блюда — то же правило, что и у продуктов. */
export function recentDishes(dishes: Dish[], limit = RECENT_LIMIT): Dish[] {
  return [...dishes].sort((a, b) => String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? ""))).slice(0, limit);
}
