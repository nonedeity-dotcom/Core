import { parseOffResponse, productUrl, type OffResult } from "../lib/balance/openfoodfacts";

/**
 * Поход в Open Food Facts за одним штрихкодом.
 *
 * Всё, что здесь есть сверх `fetch`, — это сроки и отказы. База открытая и бесплатная,
 * значит иногда медленная, а телефон в магазине живёт на одной палочке сети: без таймаута
 * экран сканера завис бы навсегда с крутящимся кружком.
 *
 * Разбор ответа сюда не входит намеренно — он в `lib/balance/openfoodfacts.ts` и
 * проверяется без сети.
 */

/** Сколько ждать ответа. Дольше — человек уже сам ушёл вводить руками. */
const TIMEOUT_MS = 12_000;

export type LookupResult = OffResult | { status: "offline" };

/**
 * Вежливое имя приложения в заголовке — то, о чём Open Food Facts прямо просит.
 *
 * По нему они отличают клиентов и, если один начнёт им мешать, ограничат его, а не всех.
 * Ничего личного в заголовке нет: имя приложения и адрес репозитория.
 */
const USER_AGENT = "Core - Android - https://github.com/nonedeity-dotcom/Core";

export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(productUrl(barcode), {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    // 404 у них означает «такого кода нет», и это обычный ответ, а не сбой связи.
    if (res.status === 404) return { status: "failed", reason: "not-found" };
    if (!res.ok) return { status: "offline" };
    return parseOffResponse(await res.json(), barcode);
  } catch {
    // Нет сети, оборвалось, вышло время: для человека это одно и то же — «сейчас не вышло,
    // введи руками». Разделять эти случаи на экране незачем.
    return { status: "offline" };
  } finally {
    clearTimeout(timer);
  }
}
