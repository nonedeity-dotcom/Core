/**
 * Russian plural form for a count: 1 день, 2 дня, 5 дней, 21 день.
 *
 * The stat cards printed a raw "{n} дней подряд" / "{n} фокус-сессий", so a
 * one-day streak read "1 дней подряд".
 */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  // Дробное число всегда идёт с родительным единственного: «1,5 порции», «0,5 порции»,
  // а не «0,5 порций». Целочисленные правила ниже на дробях врут.
  if (!Number.isInteger(n)) return few;
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
