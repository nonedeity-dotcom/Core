/**
 * Штрихкод → продукт. Разбор ответа Open Food Facts.
 *
 * База открытая: ключ не нужен, запрос — обычный GET по коду с пачки. Заполняют её люди, и
 * это видно: у одного товара всё на месте, у соседнего пустые нутриенты, энергия в
 * килоджоулях и название на языке страны, где его первым отсканировали. Поэтому разбор здесь
 * не «взять поля», а «понять, можно ли этому верить», и на выходе либо продукт, либо
 * названная причина, почему нет.
 *
 * Сеть живёт в `fetchByBarcode`, всё остальное — чистые функции над разобранным JSON: их
 * можно гонять в node на выдуманных ответах, включая те, которые вживую не поймаешь.
 */

import type { FoodProduct } from "./food";

/** Сколько килоджоулей в килокалории — по документации Open Food Facts. */
const KJ_PER_KCAL = 4.184;

export const OFF_SOURCE = "openfoodfacts";

/**
 * Только нужные поля, а не весь товар.
 *
 * Полная карточка — сотни килобайт: фотографии, добавки, следы аллергенов, история правок.
 * На мобильном интернете это разница между «секунда» и «а оно вообще работает».
 */
const FIELDS = [
  "code",
  "product_name",
  "product_name_ru",
  "generic_name_ru",
  "brands",
  "quantity",
  "serving_size",
  "nutriments",
].join(",");

export function productUrl(barcode: string): string {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
}

/**
 * Штрихкод с пачки: EAN-13, EAN-8 и UPC-A (12 цифр).
 *
 * Проверяется до запроса — не ради строгости, а чтобы не ходить в сеть за тем, чего там
 * заведомо нет: сканер иногда ловит QR с сайтом производителя или код внутренней маркировки
 * магазина.
 */
export function isBarcode(value: string): boolean {
  const digits = value.trim();
  return /^\d+$/.test(digits) && [8, 12, 13].includes(digits.length);
}

/** Почему из ответа не вышло продукта. Каждая причина — свои слова на экране. */
export type OffFailure =
  | "not-found"
  | "no-nutrition"
  | "no-name";

export type OffResult =
  | { status: "ok"; product: ScannedProduct }
  | { status: "failed"; reason: OffFailure };

/**
 * Найденный товар до того, как он стал продуктом дневника.
 *
 * Отдельный тип, потому что человек это ещё не подтвердил: числа чужие, имя может быть
 * английским, а вес порции — с чужой упаковки. Дальше он их правит, и только потом это
 * превращается в `FoodProduct`.
 */
export interface ScannedProduct {
  barcode: string;
  name: string;
  /** Марка отдельно от имени: «Простоквашино» перед «Творог 5%» человек узнаёт быстрее. */
  brand: string | null;
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  /** Вес упаковки или порции, если он указан внятно. */
  portionG?: number;
  /** Из чего получены калории: прямо в ккал или переведены из килоджоулей. */
  energyFrom: "kcal" | "kj";
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0
      ? Number(v)
      : null;

const round = (v: number, digits = 1): number => {
  const k = 10 ** digits;
  return Math.round(v * k + 1e-9) / k;
};

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Калорийность на 100 г — из того поля, которое нашлось.
 *
 * Порядок не случаен. `energy-kcal_100g` — то, что нужно. Дальше `energy-kj_100g` и общее
 * `energy_100g`, которое по умолчанию в килоджоулях: европейские этикетки пишут кДж
 * крупнее, чем ккал, и в базу попадает именно оно. Перевести делением честно, придумать —
 * нет, поэтому если ни одного поля нет, возвращается null, а не ноль: ноль калорий у творога
 * это не «нет данных», это неправда.
 */
export function energyPer100g(nutriments: Record<string, unknown>): { kcal: number; from: "kcal" | "kj" } | null {
  const kcal = num(nutriments["energy-kcal_100g"]);
  if (kcal !== null) return { kcal: round(kcal, 0), from: "kcal" };
  const kj = num(nutriments["energy-kj_100g"]) ?? num(nutriments["energy_100g"]);
  if (kj !== null) return { kcal: round(kj / KJ_PER_KCAL, 0), from: "kj" };
  return null;
}

/**
 * Вес из строки вроде «450 г», «1 л», «330 ml».
 *
 * Миллилитры считаются граммами: для молока и сока разница в пределах процента, а
 * альтернатива — не показать вес вовсе. Килограммы и литры переводятся, всё остальное
 * игнорируется: «6 шт» это не вес.
 */
export function parseQuantity(raw: unknown): number | null {
  const s = text(raw);
  if (!s) return null;
  // Не `\b` на конце: в JS границей слова считаются только латиница и цифры, поэтому «450 г»
  // ей не заканчивается и раньше не находилось вовсе. Проверяем прямо: за единицей не должна
  // идти буква — иначе «1 галлон» стал бы граммом.
  const m = s.replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(кг|kg|мл|ml|гр|г|g|л|l)(?![a-zA-Zа-яёА-ЯЁ])/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase();
  const grams =
    unit === "кг" || unit === "kg" || unit === "л" || unit === "l" ? value * 1000 : value;
  // Верхняя граница — против «10 kg» у оптовой упаковки, которую человек в дневник не кладёт.
  return grams > 0 && grams <= 5000 ? Math.round(grams) : null;
}

/**
 * Ответ Open Food Facts → готовый к показу товар.
 *
 * Три отказа, и все три разные для человека: кода нет в базе; товар есть, но нутриенты
 * никто не заполнил; товар есть, а имени нет. Молча подставлять «Продукт 4600699500094»
 * нельзя — такую строку в дневнике потом не опознать.
 */
export function parseOffResponse(raw: unknown, barcode: string): OffResult {
  if (typeof raw !== "object" || raw === null) return { status: "failed", reason: "not-found" };
  const root = raw as Record<string, unknown>;
  // status === 1 значит «нашли». У отсутствующего кода приходит 0 и пустое тело.
  const found = num(root.status) === 1 && typeof root.product === "object" && root.product !== null;
  if (!found) return { status: "failed", reason: "not-found" };

  const product = root.product as Record<string, unknown>;
  const nutriments =
    typeof product.nutriments === "object" && product.nutriments !== null
      ? (product.nutriments as Record<string, unknown>)
      : {};

  const energy = energyPer100g(nutriments);
  const protein = num(nutriments.proteins_100g);
  const fat = num(nutriments.fat_100g);
  const carb = num(nutriments.carbohydrates_100g);
  // Калорий нет — считать нечего. Макросы по отдельности могут отсутствовать и это
  // переживаемо: ноль белка у растительного масла — правда, а не пропуск.
  if (energy === null) return { status: "failed", reason: "no-nutrition" };

  // Русское имя вперёд: база международная, и у российского товара английское имя часто
  // оказывается транслитерацией, которую в списке не узнать.
  const name = text(product.product_name_ru) ?? text(product.generic_name_ru) ?? text(product.product_name);
  if (!name) return { status: "failed", reason: "no-name" };

  const portionG = parseQuantity(product.serving_size) ?? parseQuantity(product.quantity) ?? undefined;

  return {
    status: "ok",
    product: {
      barcode,
      name,
      brand: text(product.brands),
      kcal: energy.kcal,
      protein: protein === null ? 0 : round(protein),
      fat: fat === null ? 0 : round(fat),
      carb: carb === null ? 0 : round(carb),
      ...(portionG ? { portionG } : {}),
      energyFrom: energy.from,
    },
  };
}

/**
 * Имя, под которым товар ляжет в список.
 *
 * Марка впереди, если её ещё нет в названии: «Простоквашино Творог 5%» ищется и по марке, и
 * по продукту, а «Творог 5%» вторым таким же в списке уже не отличить.
 */
export function displayName(p: ScannedProduct): string {
  if (!p.brand) return p.name;
  const brand = p.brand.split(",")[0].trim();
  if (!brand || p.name.toLowerCase().includes(brand.toLowerCase())) return p.name;
  return `${brand} ${p.name}`;
}

/** Готовый к сохранению продукт — id проставит хранилище. */
export function toProduct(p: ScannedProduct): Omit<FoodProduct, "id"> {
  return {
    name: displayName(p),
    kcal: p.kcal,
    protein: p.protein,
    fat: p.fat,
    carb: p.carb,
    ...(p.portionG ? { portionG: p.portionG, unit: "portion" as const } : {}),
    barcode: p.barcode,
    source: OFF_SOURCE,
  };
}
