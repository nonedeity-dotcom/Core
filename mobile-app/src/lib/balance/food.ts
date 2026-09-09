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

/**
 * Чем считается продукт.
 *
 * Рис считают граммами, яйца — штуками, масло — ложками. Заставлять человека переводить
 * «2 яйца» в «110 г» — значит требовать от него того, что должно делать приложение: он
 * знает, сколько съел, а не сколько это весит.
 *
 * "g" — особый случай: он означает, что у продукта нет своей единицы и остаются одни
 * граммы. Поэтому он не хранится, а выводится из отсутствия `portionG`.
 */
export type Unit = "g" | "portion" | "piece" | "spoon";

/** Короткая подпись рядом с числом. */
export const UNIT_SHORT: Record<Unit, string> = {
  g: "г",
  portion: "порц.",
  piece: "шт",
  spoon: "лож.",
};

/** Формы для склонения по числу. */
export const UNIT_FORMS: Record<Unit, [string, string, string]> = {
  g: ["грамм", "грамма", "граммов"],
  portion: ["порция", "порции", "порций"],
  piece: ["штука", "штуки", "штук"],
  spoon: ["ложка", "ложки", "ложек"],
};

/**
 * Форма «в одной ...»: «в одной штуке», «по 17 г в ложке».
 *
 * Отдельной таблицей, потому что именительный падеж в этих фразах читается сломанным: «по
 * 55 г за штука» — это не по-русски, а строку человек видит каждый раз, когда что-то
 * добавляет.
 */
export const UNIT_IN_ONE: Record<Unit, string> = {
  g: "грамме",
  portion: "порции",
  piece: "штуке",
  spoon: "ложке",
};

/** Как единица называется в настройках продукта. */
export const UNIT_LABELS: Record<Unit, string> = {
  g: "Только граммы",
  portion: "Порция",
  piece: "Штука",
  spoon: "Ложка",
};

export interface FoodProduct extends Nutrition {
  id: string;
  name: string;
  /**
   * Сколько граммов в одной единице. Без него остаются одни граммы: «2 порции» без веса
   * порции — это не количество, а надежда.
   */
  portionG?: number;
  /** Чем считается. Осмысленно только вместе с `portionG`; старые продукты — порции. */
  unit?: Exclude<Unit, "g">;
  /** Когда его последний раз добавляли — по этому строится «Часто ем». */
  lastUsedAt?: string;
}

/**
 * Чем на самом деле считается продукт.
 *
 * Единица без веса единицы бессмысленна — сколько граммов в «штуке», знает только продукт,
 * — поэтому она и выводится из `portionG`, а не берётся из поля напрямую.
 */
export function unitOf(product: Pick<FoodProduct, "portionG" | "unit">): Unit {
  if (!product.portionG || product.portionG <= 0) return "g";
  return product.unit ?? "portion";
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
  /**
   * В чём это записали и сколько единиц вышло — снимок на момент записи, как и макросы.
   *
   * «Яйцо, 110 г» — это перевод, который человек не делал и в котором себя не узнаёт. Он
   * съел два яйца, и строка дневника должна говорить это. Хранится рядом с граммами, а не
   * вместо них: считается всё по-прежнему в граммах.
   */
  units?: number;
  unit?: Exclude<Unit, "g">;
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
    // Единица без веса единицы ничего не значит, поэтому и не хранится без него.
    ...(portion > 0 && (v.unit === "piece" || v.unit === "spoon" || v.unit === "portion")
      ? { unit: v.unit }
      : {}),
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
    // Пронесённый dishId — не украшение: по нему блюдо получает отметку «только что
    // использовано», из которой строится порядок в списке. Терялся здесь, и порядок блюд
    // молча не работал.
    ...(isStr(v.dishId) && v.dishId !== "" ? { dishId: v.dishId } : {}),
    name: v.name,
    grams: round(num(v.grams)),
    kcal: round(num(v.kcal)),
    protein: round(num(v.protein), 1),
    fat: round(num(v.fat), 1),
    carb: round(num(v.carb), 1),
    ...(typeof v.units === "number" && Number.isFinite(v.units) && v.units > 0
      ? { units: round(v.units, 2) }
      : {}),
    ...(v.unit === "piece" || v.unit === "spoon" || v.unit === "portion" ? { unit: v.unit } : {}),
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

/**
 * Как назвать количество: «2 шт», «400 г», «1.5 порции».
 *
 * Дробное число единиц пишется как есть: полторы ложки — это полторы ложки, а «22 г» вместо
 * них человек не проверит.
 */
export function formatAmount(amount: number, unit: Unit): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded} ${UNIT_SHORT[unit]}`;
}

/**
 * Что писать в строке дневника: «2 шт · 110 г» или просто «400 г».
 *
 * Граммы остаются рядом даже там, где считали штуками: по ним сходится день, и когда сумма
 * не сойдётся, искать причину будут именно в них.
 */
export function describeEntryAmount(entry: FoodEntry): string {
  if (!entry.units || !entry.unit) return `${entry.grams} г`;
  return `${formatAmount(entry.units, entry.unit)} · ${entry.grams} г`;
}

/** Шаг стрелки для этого продукта: одна единица там, где она есть, иначе 25 граммов. */
export function stepGrams(product: Pick<FoodProduct, "portionG" | "unit">): number {
  return unitOf(product) === "g" ? 25 : (product.portionG ?? 25);
}

/**
 * Питательность записи в пересчёте на 100 г — то, из чего она была посчитана.
 *
 * Берётся из самой записи, а не из продукта: продукт мог измениться или исчезнуть, а
 * поправка веса в дневнике не должна тихо пересчитывать съеденное по новым числам. Запись
 * знает свои граммы и свои макросы, и этого достаточно.
 */
export function per100(entry: FoodEntry): Nutrition {
  if (entry.grams <= 0) return { ...ZERO };
  const k = 100 / entry.grams;
  return {
    kcal: entry.kcal * k,
    protein: entry.protein * k,
    fat: entry.fat * k,
    carb: entry.carb * k,
  };
}

/** Та же запись, но на другой вес. Для правки «съел не 200 г, а 150». */
export function rescaleEntry(entry: FoodEntry, grams: number): Nutrition {
  return nutritionFor(per100(entry), grams);
}

/**
 * Поиск по блюдам — тем же правилом, что и по продуктам.
 *
 * Раньше блюда просто исчезали, стоило начать печатать: искалось только среди продуктов, а
 * список блюд показывался лишь при пустом поле. Блюдо с названием «Курица с рисом» нельзя
 * было найти по слову «курица», и после двух десятков блюд часть переставала быть доступной
 * вообще.
 */
export function searchDishes(dishes: Dish[], query: string): Dish[] {
  const q = query.trim().toLowerCase();
  if (!q) return dishes;
  return dishes
    .filter((d) => d.name.toLowerCase().includes(q))
    .sort((a, b) => {
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
