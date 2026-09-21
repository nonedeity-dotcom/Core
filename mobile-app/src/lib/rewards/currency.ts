/**
 * Две валюты и кошелёк.
 *
 * Искры — частые и расходуемые: капают за закрытые дни, фокус-сессии и собранные поля,
 * тратятся на подсказки и прочее одноразовое. Их много, и они на то и нужны, чтобы их
 * тратить не задумываясь.
 *
 * Ядра — редкие и «навсегда»: только за крупное и неповторимое — вехи серии, написанный
 * итог месяца, полностью закрытая цель. На них покупается то, что остаётся: наборы цветов,
 * темы, титулы. Копятся неделями, и в этом весь смысл.
 *
 * Главное правило всей этой механики живёт здесь же: **каждое событие оплачивается ровно
 * один раз**. Не «сколько-то за день», а «за этот конкретный день, и больше никогда».
 * Поэтому начисление хранит не только счёт, но и ключи того, что уже оплачено. Без этого
 * настройка планки дня превратилась бы в кнопку «выдать себе денег»: понизил планку —
 * прошлое пересчиталось — доплатили.
 */

export type Currency = "sparks" | "cores";

export interface Wallet {
  sparks: number;
  cores: number;
}

export const EMPTY_WALLET: Wallet = { sparks: 0, cores: 0 };

/** Одно начисление: за что, сколько и когда. */
export interface Award {
  /** Ключ события. Он же и защита от повторной оплаты. */
  key: string;
  /** Как это назвать в списке начислений. */
  title: string;
  sparks: number;
  cores: number;
}

/**
 * Что из купленного надето.
 *
 * Отдельно от `owned`, потому что это разные вопросы: «есть ли у меня» и «что сейчас
 * применено». Купить четыре набора цветов можно, а поле красится одним.
 */
export interface Equipped {
  /** Набор цветов для найденных слов. */
  palette: string;
  /** Акцентный цвет приложения. Подействует со следующего запуска. */
  accent: string;
  /** Надетый титул — заработанный или купленный. Пустая строка значит «без титула». */
  title: string;
}

export const DEFAULT_EQUIPPED: Equipped = { palette: "palette-default", accent: "accent-default", title: "" };

export type Slot = keyof Equipped;

export interface Purse {
  wallet: Wallet;
  /** Ключи уже оплаченных событий. */
  paid: string[];
  /** Что куплено в магазине — идентификаторы товаров. */
  owned: string[];
  /**
   * Последние начисления, новые сверху. Только для показа: кошелёк считается не по ним.
   *
   * Список подрезается, потому что за год их накопятся тысячи, а прочитают из них пять.
   */
  history: { key: string; title: string; sparks: number; cores: number; at: string }[];
  equipped: Equipped;
}

export const HISTORY_LIMIT = 40;

export const EMPTY_PURSE: Purse = {
  wallet: { ...EMPTY_WALLET },
  paid: [],
  owned: [],
  history: [],
  equipped: { ...DEFAULT_EQUIPPED },
};

const int = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function normalizePurse(raw: unknown): Purse {
  if (typeof raw !== "object" || raw === null)
    return { ...EMPTY_PURSE, wallet: { ...EMPTY_WALLET }, equipped: { ...DEFAULT_EQUIPPED } };
  const o = raw as Record<string, unknown>;
  const e = (typeof o.equipped === "object" && o.equipped !== null ? o.equipped : {}) as Record<string, unknown>;
  const slot = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const w = (typeof o.wallet === "object" && o.wallet !== null ? o.wallet : {}) as Record<string, unknown>;
  const history = Array.isArray(o.history) ? o.history : [];
  return {
    wallet: { sparks: int(w.sparks), cores: int(w.cores) },
    // Повторы ключей ничего не ломают, но список растёт, а он и так самый длинный здесь.
    paid: [...new Set(strings(o.paid))],
    owned: [...new Set(strings(o.owned))],
    history: history
      .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
      .map((h) => ({
        key: typeof h.key === "string" ? h.key : "",
        title: typeof h.title === "string" ? h.title : "",
        sparks: int(h.sparks),
        cores: int(h.cores),
        at: typeof h.at === "string" ? h.at : "",
      }))
      .filter((h) => h.key !== "")
      .slice(0, HISTORY_LIMIT),
    equipped: {
      palette: slot(e.palette, DEFAULT_EQUIPPED.palette),
      accent: slot(e.accent, DEFAULT_EQUIPPED.accent),
      title: slot(e.title, DEFAULT_EQUIPPED.title),
    },
  };
}

/**
 * Кошелёк после начислений.
 *
 * Уже оплаченное отбрасывается здесь, а не у зовущего: это последняя черта, за которой
 * деньги появляются из ничего, и проверять её надо в одном месте.
 */
export function applyAwards(purse: Purse, awards: Award[], today: string): Purse {
  const fresh = awards.filter((a) => !purse.paid.includes(a.key));
  if (fresh.length === 0) return purse;
  return {
    wallet: {
      sparks: purse.wallet.sparks + fresh.reduce((n, a) => n + a.sparks, 0),
      cores: purse.wallet.cores + fresh.reduce((n, a) => n + a.cores, 0),
    },
    paid: [...purse.paid, ...fresh.map((a) => a.key)],
    owned: purse.owned,
    equipped: purse.equipped,
    history: [
      ...fresh.map((a) => ({ key: a.key, title: a.title, sparks: a.sparks, cores: a.cores, at: today })),
      ...purse.history,
    ].slice(0, HISTORY_LIMIT),
  };
}

/** Хватает ли на покупку. */
export const canAfford = (wallet: Wallet, price: { sparks?: number; cores?: number }): boolean =>
  wallet.sparks >= (price.sparks ?? 0) && wallet.cores >= (price.cores ?? 0);

/**
 * Списание.
 *
 * Возвращает `null`, когда не хватает: молча уйти в минус хуже, чем отказать, — минус в
 * кошельке потом не объяснить ничем.
 */
export function spend(purse: Purse, price: { sparks?: number; cores?: number }): Purse | null {
  if (!canAfford(purse.wallet, price)) return null;
  return {
    ...purse,
    wallet: {
      sparks: purse.wallet.sparks - (price.sparks ?? 0),
      cores: purse.wallet.cores - (price.cores ?? 0),
    },
  };
}

/** Покупка предмета: списать и записать во владение. */
export function buy(purse: Purse, id: string, price: { sparks?: number; cores?: number }): Purse | null {
  if (purse.owned.includes(id)) return null;
  const paid = spend(purse, price);
  return paid ? { ...paid, owned: [...paid.owned, id] } : null;
}

/**
 * Надеть купленное.
 *
 * Покупка сама ничего не надевает — кроме первой: купить набор и не увидеть его — это
 * ровно тот случай, когда человек решает, что кнопка сломана. Поэтому надевает тот, кто
 * покупает, а эта функция только меняет слот.
 */
export const equip = (purse: Purse, slot: Slot, id: string): Purse => ({
  ...purse,
  equipped: { ...purse.equipped, [slot]: id },
});

/** «1 240» — большие числа читаются пробелами, а не сплошняком. */
export const formatAmount = (n: number): string => n.toLocaleString("ru-RU").replace(/ /g, " ");
