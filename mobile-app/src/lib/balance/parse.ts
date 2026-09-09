import { unitOf, type FoodProduct, type Unit } from "./food";

/**
 * Разбор строки вида «400 г риса и 2 яйца».
 *
 * Это не понимание еды, а быстрый способ выбрать из **своего** списка: встроенной базы у
 * «Баланса» нет, и узнаётся только то, что уже заведено. «400 г риса» не сработает, пока в
 * списке нет «Рис», — и это честнее, чем угадать похожее.
 *
 * Разобранное никогда не пишется в дневник само. Оно складывается в набор, где видно
 * построчно, что понято, и всё можно поправить обычными стрелками. Дневник, который тихо
 * записал не то, хуже дневника, который переспросил.
 */

/** Что удалось вычитать из одного куска строки. */
export interface ParsedItem {
  /** Кусок строки, из которого это получилось, — чтобы показать непонятое как есть. */
  raw: string;
  /** Найденный продукт, либо null, если ничего похожего в списке нет. */
  productId: string | null;
  /** Число, которое назвали. */
  amount: number;
  /** В чём назвали: граммы или единица продукта. */
  unit: Unit;
  /** Во что это переводится. null — если продукт не нашёлся и переводить нечем. */
  grams: number | null;
}

/** Слова-единицы. Порядок важен: «гр» не должно съедать «грудка», поэтому сверяемся целиком. */
const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/^(г|гр|грамм|грамма|граммов|грам)$/i, "g"],
  [/^(шт|шт\.|штука|штуки|штук|штуку)$/i, "piece"],
  [/^(л|лож|ложка|ложки|ложек|ложку|ст\.л|стл)$/i, "spoon"],
  [/^(порц|порц\.|порция|порции|порций|порцию)$/i, "portion"],
];

/**
 * Грубая основа слова.
 *
 * Полноценная морфология здесь не нужна и вредна: сверяются два десятка своих названий, а не
 * словарь языка. Отрезаются только окончания — согласные не трогаются, поэтому «рис»
 * остаётся «рис», а не превращается в «ри» и не начинает совпадать с чем попало.
 */
export function stem(word: string): string {
  // «й» и «и» приравниваются: «яйцо» и «яиц» — одно слово, но буква в основе меняется, и
  // без этого главный пример задачи — «2 яйца» — узнавался, а «пара яиц» уже нет.
  const w = word
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/й/g, "и")
    .replace(/[^a-zа-я0-9]/g, "");
  // Длинные окончания снимаются первыми, иначе «ами» никогда не дойдёт до проверки.
  const endings = ["ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ая", "яя", "ое",
    "ее", "ые", "ие", "ой", "ей", "ый", "ий", "ов", "ев", "ах", "ях", "ью", "ам", "ям",
    "а", "я", "о", "е", "ы", "и", "у", "ю", "ь"];
  for (const end of endings) {
    // Основа короче трёх букв — это уже не основа, а обрубок: «щи» так не сломать.
    if (w.length - end.length >= 3 && w.endsWith(end)) return w.slice(0, w.length - end.length);
  }
  return w;
}

/** Совпадают ли две основы. Одна должна начинаться с другой — «рис» так не найдёт «редис». */
function stemsMatch(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return a === b;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Какой продукт имели в виду.
 *
 * Считается, сколько слов запроса нашлось в названии. При равенстве побеждает более короткое
 * название: «Рис» вернее «Рис отварной», если сказали просто «риса».
 */
export function matchProduct(words: string[], products: FoodProduct[]): FoodProduct | null {
  const queryStems = words.map(stem).filter((w) => w.length >= 2);
  if (queryStems.length === 0) return null;

  let best: { product: FoodProduct; hits: number } | null = null;
  for (const product of products) {
    const nameStems = product.name.split(/\s+/).map(stem).filter(Boolean);
    const hits = queryStems.filter((q) => nameStems.some((n) => stemsMatch(q, n))).length;
    if (hits === 0) continue;
    if (!best || hits > best.hits || (hits === best.hits && product.name.length < best.product.name.length)) {
      best = { product, hits };
    }
  }
  return best?.product ?? null;
}

/**
 * Куски строки: «и», запятые, плюсы и переводы строки — всё это «а ещё».
 *
 * Союз ищется как отдельное слово между пробелами, а не через `\b`: границы слов в
 * JavaScript считаются по латинице, кириллическая буква для них — не буква, и `\bи\b` не
 * срабатывало ни разу. «400 г риса и 2 яйца» разбиралось как одна позиция.
 */
function chunks(line: string): string[] {
  return line
    // Запятая внутри числа — это дробь, а не «а ещё»: «1,5 ложки» рвалось на «1» и
    // «5 ложки». Десятичная запятая приводится к точке до разрезания.
    .replace(/(\d),(\d)/g, "$1.$2")
    .split(/\s*[,;+\n]\s*|\s+(?:и|да|плюс|ещё|еще)\s+/i)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/**
 * Разбирает строку в набор позиций.
 *
 * Число ищется где угодно в куске: «400 г риса» и «риса 400» — одно и то же, и требовать
 * определённого порядка значит требовать помнить правило.
 */
export function parseFoodLine(line: string, products: FoodProduct[]): ParsedItem[] {
  return chunks(line).map((raw) => parseChunk(raw, products));
}

function parseChunk(raw: string, products: FoodProduct[]): ParsedItem {
  const tokens = raw.split(/\s+/).filter(Boolean);

  // Число: первое, что читается как число. Запятая как разделитель дроби — «1,5 ложки».
  let amount = 0;
  let amountAt = -1;
  tokens.forEach((t, i) => {
    if (amountAt !== -1) return;
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n) && n > 0) {
      amount = n;
      amountAt = i;
      return;
    }
    // «400г» без пробела — тоже число.
    const glued = /^(\d+(?:[.,]\d+)?)([а-яa-z.]+)$/i.exec(t);
    if (glued) {
      const g = Number(glued[1].replace(",", "."));
      if (Number.isFinite(g) && g > 0) {
        amount = g;
        amountAt = i;
        tokens[i] = glued[2];
      }
    }
  });

  // Единица: слово рядом с числом. Если её не назвали — решает сам продукт.
  let named: Unit | null = null;
  const rest: string[] = [];
  tokens.forEach((t, i) => {
    if (i === amountAt) return;
    const hit = UNIT_WORDS.find(([re]) => re.test(t));
    if (hit && named === null) {
      named = hit[1];
      return;
    }
    rest.push(t);
  });

  const product = matchProduct(rest, products);
  if (!product) {
    return { raw, productId: null, amount, unit: named ?? "g", grams: null };
  }

  const own = unitOf(product);
  const perUnit = product.portionG ?? 0;

  // Единицу не назвали — надо решить за человека, и решать приходится по величине числа.
  //
  // «2 яйца» — это две штуки, «150 грудки» — сто пятьдесят граммов. Просто брать свою
  // единицу продукта нельзя: тогда «150 грудки» превращалось в сто пятьдесят порций, то
  // есть в двадцать два килограмма курицы, и молча.
  //
  // Порог — вес самой единицы, а не выдуманное число: если названо меньше, чем весит одна
  // штука, речь почти наверняка о штуках (два яйца, три ложки), а если больше — о граммах
  // (шестьдесят яиц никто не ест, шестьдесят граммов яйца — половина яйца). Промах в
  // спорной зоне не страшен: разобранное показывается и правится до записи.
  const unit: Unit =
    named ?? (own === "g" || perUnit <= 0 ? "g" : amount < perUnit ? own : "g");
  // Назвали штуки у продукта, который считается граммами, — считать нечем, берём граммы.
  const grams = unit === "g" || perUnit <= 0 ? Math.round(amount) : Math.round(amount * perUnit);

  return {
    raw,
    productId: product.id,
    amount,
    unit: unit === "g" || perUnit <= 0 ? "g" : unit,
    grams: grams > 0 ? grams : null,
  };
}
