/**
 * Кто ты и сколько тебе положено — вся арифметика CaloriX в одном месте.
 *
 * Ничего здесь не знает ни про хранилище, ни про экраны: на входе профиль, на выходе числа.
 * Формулы взяты ровно те, которые были заказаны, и ни одна из них не является истиной —
 * это оценки, и приложение говорит об этом там, где их показывает.
 */

export type Sex = "male" | "female";

export type Goal =
  /** TDEE + 400 */
  | "gain"
  /** TDEE */
  | "keep"
  /** TDEE − 400 */
  | "lose";

/** Множители к базовому обмену — пять привычных ступеней. */
export type Activity = "sedentary" | "light" | "moderate" | "high" | "veryHigh";

export const ACTIVITY_FACTORS: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  veryHigh: 1.9,
};

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: "Сидячий",
  light: "Лёгкая",
  moderate: "Средняя",
  high: "Высокая",
  veryHigh: "Очень высокая",
};

export const ACTIVITY_HINTS: Record<Activity, string> = {
  sedentary: "почти без движения",
  light: "1–3 тренировки в неделю",
  moderate: "3–5 тренировок в неделю",
  high: "6–7 тренировок в неделю",
  veryHigh: "тяжёлый труд или две тренировки в день",
};

export const GOAL_LABELS: Record<Goal, string> = {
  gain: "Набор массы",
  keep: "Поддержание",
  lose: "Похудение",
};

/** Сколько калорий цель прибавляет к расходу или отнимает от него. */
export const GOAL_SHIFT: Record<Goal, number> = { gain: 400, keep: 0, lose: -400 };

export interface Profile {
  sex: Sex;
  /** Полных лет. */
  age: number;
  /** Сантиметры. */
  heightCm: number;
  /** Килограммы, одно текущее число — меняется руками. */
  weightKg: number;
  activity: Activity;
  goal: Goal;
}

/** С чего начинается пустой профиль — не «правда о вас», а просто нейтральная точка. */
export const DEFAULT_PROFILE: Profile = {
  sex: "male",
  age: 25,
  heightCm: 175,
  weightKg: 70,
  activity: "moderate",
  goal: "keep",
};

/** Границы, за которыми число перестаёт быть ростом, весом или возрастом. */
export const LIMITS = {
  age: { min: 14, max: 100 },
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 30, max: 250 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function normalizeProfile(value: unknown): Profile | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : NaN);
  const age = num(v.age);
  const heightCm = num(v.heightCm);
  const weightKg = num(v.weightKg);
  // Неполный профиль — это не профиль: считать по нему нечего, а показывать половину норм
  // хуже, чем честно попросить дозаполнить.
  if (Number.isNaN(age) || Number.isNaN(heightCm) || Number.isNaN(weightKg)) return null;
  return {
    sex: v.sex === "female" ? "female" : "male",
    age: Math.round(clamp(age, LIMITS.age.min, LIMITS.age.max)),
    heightCm: Math.round(clamp(heightCm, LIMITS.heightCm.min, LIMITS.heightCm.max)),
    weightKg: Math.round(clamp(weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max) * 10) / 10,
    activity: typeof v.activity === "string" && v.activity in ACTIVITY_FACTORS ? (v.activity as Activity) : "moderate",
    goal: v.goal === "gain" || v.goal === "lose" ? v.goal : "keep",
  };
}

/**
 * Базовый обмен по Миффлину — Сан Жеору.
 *
 * `10 × вес + 6.25 × рост − 5 × возраст + 5` для мужчин и `− 161` для женщин. Это оценка со
 * своей погрешностью — формула выведена на выборке, а не на вас, — и попадание ±10 % здесь
 * считается хорошим результатом.
 */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(base + (p.sex === "male" ? 5 : -161));
}

/** Расход за день: базовый обмен, умноженный на коэффициент активности. */
export function tdee(p: Profile): number {
  return Math.round(bmr(p) * ACTIVITY_FACTORS[p.activity]);
}

export interface Targets {
  calories: number;
  proteinG: number;
  fatG: number;
  carbG: number;
}

/** Калории на грамм — то, из чего складывается остаток под углеводы. */
export const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 };

/** Белок 1.8 г/кг, жиры 1 г/кг — заданные числа, не выведенные. */
export const PROTEIN_PER_KG = 1.8;
export const FAT_PER_KG = 1;

/**
 * Нормы на день.
 *
 * Белок и жиры — от веса, углеводы — всё, что осталось от калорий после них. Остаток может
 * уйти в ноль (при похудении с большим весом жиры и белок способны съесть всю норму), и
 * тогда это ноль, а не отрицательное число: «−120 г углеводов» не значит ничего, а ноль
 * честно говорит, что цифры не сходятся и надо менять цель или коэффициент.
 */
export function targets(p: Profile): Targets {
  const calories = Math.max(0, tdee(p) + GOAL_SHIFT[p.goal]);
  const proteinG = Math.round(p.weightKg * PROTEIN_PER_KG);
  const fatG = Math.round(p.weightKg * FAT_PER_KG);
  const left = calories - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  return { calories, proteinG, fatG, carbG: Math.max(0, Math.round(left / KCAL_PER_G.carb)) };
}
