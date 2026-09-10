import type { Activity, Profile } from "./profile";

/**
 * Вода за день.
 *
 * Считается в миллилитрах и по дням, ровно как всё остальное в дневнике. Отдельная запись,
 * а не продукт в еде: у воды нет калорий, ей нечего делать в сумме съеденного, а вопрос
 * «сколько я сегодня выпил» — свой собственный и задаётся отдельно.
 *
 * Считается вся жидкость, а не только вода из-под крана: чай, кофе, молоко, сок, суп. Миф о
 * том, что кофе обезвоживает, к обычным трём-четырём чашкам не относится — мочегонное
 * действие кофеина слабое и перекрывается объёмом самой чашки. Поэтому кнопка называется
 * «стакан», а не «стакан воды».
 */

export interface WaterDay {
  /** Ключ дня, "yyyy-MM-dd". Одна запись на день: она накапливается, а не заменяется. */
  date: string;
  /** Сколько выпито за день, мл. */
  ml: number;
}

/** Стакан. Столько наливают, когда не меряют. */
export const GLASS_ML = 250;

/** Больше этого за сутки человек не выпивает, а если выпивает — это уже вопрос к врачу. */
export const MAX_DAY_ML = 10_000;

/** Сколько дней истории имеет смысл держать и читать. */
export const WATER_WINDOW_DAYS = 400;

export function normalizeWaterDay(value: unknown): WaterDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (typeof v.ml !== "number" || !Number.isFinite(v.ml) || v.ml <= 0) return null;
  return { date: v.date, ml: Math.min(MAX_DAY_ML, Math.round(v.ml)) };
}

/**
 * Миллилитры на килограмм веса — по тому, сколько человек двигается.
 *
 * Тридцать миллилитров на килограмм — обычный ориентир для взрослого; тренировки добавляют
 * к нему пот, и это единственное, что здесь учитывается сверх веса. Разброс небольшой
 * намеренно: настоящая поправка на жару, болезнь и длинную тренировку по анкете не
 * считается, и делать вид, что считается, — врать точностью.
 */
const ML_PER_KG: Record<Activity, number> = {
  sedentary: 30,
  light: 32,
  moderate: 33,
  high: 35,
  veryHigh: 37,
};

/**
 * Сколько пить в день, мл.
 *
 * Округляется до сотни: «1700» — это ориентир, а «1683» выглядело бы измерением, которого
 * никто не делал. Цель на норму не влияет: и при наборе, и при похудении воды нужно больше
 * обычного, но по одной и той же причине — больше еды и больше белка, — а это уже учтено
 * весом и активностью.
 */
export function waterTarget(profile: Profile): number {
  const raw = profile.weightKg * ML_PER_KG[profile.activity];
  return Math.round(raw / 100) * 100;
}

/** Литры для показа: «1,5 л». Меньше литра показывается миллилитрами. */
export function formatWater(ml: number): string {
  if (ml < 1000) return `${Math.round(ml)} мл`;
  const litres = Math.round(ml / 100) / 10;
  return `${litres.toFixed(1).replace(".", ",")} л`;
}

export function waterFor(log: WaterDay[], date: string): number {
  return log.find((d) => d.date === date)?.ml ?? 0;
}

/** Среднее за дни, в которые вообще пили — те же правила, что у дневника еды. */
export function averageWater(log: WaterDay[], dates: string[]): { ml: number; days: number } {
  const inWindow = log.filter((d) => dates.includes(d.date) && d.ml > 0);
  if (inWindow.length === 0) return { ml: 0, days: 0 };
  const sum = inWindow.reduce((s, d) => s + d.ml, 0);
  return { ml: Math.round(sum / inWindow.length), days: inWindow.length };
}
