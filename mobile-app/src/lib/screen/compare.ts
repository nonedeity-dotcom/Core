/**
 * Сравнение периода с предыдущим таким же.
 *
 * Перенос `usageChange` из creker вместе с решением, которое там записано прямо: раньше
 * существовало только «сэкономлено», то есть экран заговаривал, только когда число падало.
 * Трекер, который открывает рот лишь тогда, когда цифра льстит, — это не отчёт, а
 * подбадривание. Изменение показывается в обе стороны.
 */

export interface UsageComparison {
  /** Всегда положительный; направление несёт `isDecrease`. */
  percent: number;
  isDecrease: boolean;
  /** Однодневный период сравнивается со вчера, и подпись должна это говорить. */
  comparedToYesterday: boolean;
}

/**
 * Насколько текущее отличается от прошлого.
 *
 * `null`, когда сравнивать не с чем (за прошлый период ничего не сохранено) или когда
 * разница округляется в ноль: «на 0 % больше» — это не новость, а шум.
 */
export function usageChange(current: number, previous: number, dayCount: number): UsageComparison | null {
  if (previous <= 0) return null;
  const percent = Math.round(((current - previous) * 100) / previous);
  if (percent === 0) return null;
  return {
    percent: Math.abs(percent),
    isDecrease: percent < 0,
    comparedToYesterday: dayCount === 1,
  };
}

/** Как это прочитать вслух: «на 12 % меньше, чем вчера». */
export function describeChange(change: UsageComparison): string {
  const direction = change.isDecrease ? "меньше" : "больше";
  const than = change.comparedToYesterday ? "чем вчера" : "чем в прошлый такой же период";
  return `на ${change.percent} % ${direction}, ${than}`;
}
