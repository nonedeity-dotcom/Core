/**
 * Сколько дней до нужного веса — и на каком весе всё остановится, если не менять еду.
 *
 * Считается не одной формулой, а днём за днём. Причина ровно та, которую подсказывает
 * здравый смысл: чем больше человек весит, тем больше он тратит. Ешь фиксированные 2800 при
 * весе 60 — это плюс 500 в день; на 70 килограммах те же 2800 дают уже плюс 250, а на 80 не
 * дают ничего. Набор на постоянной еде не идёт прямой линией — он тормозит и упирается в
 * потолок, и «7700 делить на профицит» этого потолка не видит: она бодро напечатает число
 * дней, которого не будет.
 *
 * Отсюда два прогноза. «По норме» — если есть столько, сколько приложение написало: норма
 * пересчитывается от веса, поэтому профицит держится и потолка нет. «По факту» — если есть
 * так, как ел на самом деле: еда постоянная, и потолок есть почти всегда.
 *
 * Модуль чистый: на входе профиль и числа, на выходе числа. Ни хранилища, ни экранов.
 */

import { KCAL_PER_KG, RATE_PERCENT, goalShift } from "./calibrate";
import { ACTIVITY_FACTORS, bmr, tdee, type Profile } from "./profile";

/** Дальше трёх лет прогноз — это уже не прогноз. */
export const MAX_FORECAST_DAYS = 1095;

/** Ближе двухсот граммов к цели считается «уже пришёл»: весы столько наврут за утро. */
export const REACHED_KG = 0.2;

/**
 * Настоящий расход, а не формульный.
 *
 * Поправка со весов — это и есть то, на сколько формула промахнулась именно на этом
 * человеке. Прогноз обязан считать по исправленному расходу: иначе он берёт ту самую ошибку,
 * которую приложение уже измерило, и переносит её на полгода вперёд.
 */
export function maintenance(p: Profile): number {
  return tdee(p) + (p.adjustKcal ?? 0);
}

const withWeight = (p: Profile, weightKg: number): Profile => ({ ...p, weightKg });

/**
 * Вес, на котором расход догонит эту еду и набор остановится.
 *
 * Решается напрямую, а не подбором: расход линеен по весу, и обратить его — школьная
 * алгебра. `tdee = (10·вес + 6.25·рост − 5·возраст + s) · k`, отсюда вес при заданном
 * расходе.
 */
export function plateauWeight(p: Profile, intakeKcal: number): number {
  const k = ACTIVITY_FACTORS[p.activity];
  const s = p.sex === "male" ? 5 : -161;
  const adjust = p.adjustKcal ?? 0;
  const base = (intakeKcal - adjust) / k - 6.25 * p.heightCm + 5 * p.age - s;
  return Math.round((base / 10) * 10) / 10;
}

export type Forecast =
  /** Цель уже достигнута — идти некуда. */
  | { kind: "already" }
  /** Дойдёт: столько дней и с таким темпом. */
  | { kind: "reach"; days: number; rateKgPerWeek: number }
  /**
   * Не дойдёт: расход догонит еду раньше цели. Это не «долго», это «никогда», и число
   * дней тут было бы враньём — поэтому вместо него вес, на котором всё встанет.
   */
  | { kind: "stalls"; plateauKg: number }
  /** Едет в другую сторону: при наборе это еда ниже расхода. */
  | { kind: "wrong-way"; plateauKg: number };

export interface ForecastInput {
  profile: Profile;
  targetWeightKg: number;
  /**
   * Постоянная еда в день — прогноз «по факту».
   *
   * `null` — прогноз «по норме»: еда каждый день берётся заново из веса, как её и считает
   * приложение. Разница между этими двумя и есть то, ради чего экран существует.
   */
  intakeKcal: number | null;
}

/** Еда этого дня: постоянная — или норма, пересчитанная от сегодняшнего веса. */
const intakeAt = (p: Profile, weightKg: number, fixed: number | null): number =>
  fixed ?? maintenance(withWeight(p, weightKg)) + goalShift(withWeight(p, weightKg));

export function forecast({ profile, targetWeightKg, intakeKcal }: ForecastInput): Forecast {
  const start = profile.weightKg;
  const gap = targetWeightKg - start;
  if (Math.abs(gap) < REACHED_KG) return { kind: "already" };
  const up = gap > 0;

  // Куда вообще двинется вес на сегодняшней еде — и двинется ли.
  const firstDelta = intakeAt(profile, start, intakeKcal) - maintenance(profile);
  if (up ? firstDelta <= 0 : firstDelta >= 0) {
    return { kind: "wrong-way", plateauKg: plateauWeight(profile, intakeAt(profile, start, intakeKcal)) };
  }

  // На постоянной еде потолок известен заранее: если цель за ним, никакое число дней её не
  // достанет, и считать их не нужно.
  if (intakeKcal !== null) {
    const ceiling = plateauWeight(profile, intakeKcal);
    if (up ? targetWeightKg > ceiling : targetWeightKg < ceiling) {
      return { kind: "stalls", plateauKg: ceiling };
    }
  }

  let weight = start;
  for (let day = 1; day <= MAX_FORECAST_DAYS; day++) {
    weight += (intakeAt(profile, weight, intakeKcal) - maintenance(withWeight(profile, weight))) / KCAL_PER_KG;
    if (up ? weight >= targetWeightKg : weight <= targetWeightKg) {
      return { kind: "reach", days: day, rateKgPerWeek: ((weight - start) / day) * 7 };
    }
  }
  // Три года и не дошёл. Формально не потолок, но для человека это то же самое.
  return { kind: "stalls", plateauKg: Math.round(weight * 10) / 10 };
}

/**
 * Сколько есть в день, чтобы прийти к цели ровно в срок.
 *
 * Подбором, а не формулой: вес входит в расход, расход — в завтрашний вес, и обратить это
 * в одну строчку нельзя. Зато результат по еде монотонен — больше ешь, больше весишь к
 * сроку, — и половинное деление сходится за два десятка шагов.
 *
 * `null`, когда срок уже прошёл или когда нужная еда выходит за всякие рамки: «ешь 9000 в
 * день» — это не совет, это признак того, что срок поставлен не тот.
 */
export function requiredIntake(p: Profile, targetWeightKg: number, days: number): number | null {
  if (days <= 0) return null;
  const base = maintenance(p);
  const lo = Math.max(500, base * 0.4);
  const hi = base * 2.5;

  const endWeight = (intake: number): number => {
    let w = p.weightKg;
    for (let i = 0; i < days; i++) w += (intake - maintenance(withWeight(p, w))) / KCAL_PER_KG;
    return w;
  };

  if (endWeight(lo) > targetWeightKg || endWeight(hi) < targetWeightKg) return null;

  let a = lo;
  let b = hi;
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    if (endWeight(mid) < targetWeightKg) a = mid;
    else b = mid;
  }
  return Math.round((a + b) / 2 / 10) * 10;
}

/** Темп в процентах от веса за неделю — в этом же виде задана и здоровая вилка. */
export function ratePercentPerWeek(rateKgPerWeek: number, weightKg: number): number {
  return weightKg > 0 ? (rateKgPerWeek / weightKg) * 100 : 0;
}

export type RateVerdict = "ok" | "fast" | "slow";

/**
 * Быстро, медленно или в самый раз — по той же вилке, которой приложение меряет весы.
 *
 * Сравнивается модуль темпа с модулем границ, чтобы одна проверка работала и на наборе, и
 * на похудении: там вилка отрицательная, и «быстрее» значит «ниже».
 */
export function rateVerdict(p: Profile, rateKgPerWeek: number): RateVerdict {
  const r = RATE_PERCENT[p.goal];
  const percent = Math.abs(ratePercentPerWeek(rateKgPerWeek, p.weightKg));
  const from = Math.min(Math.abs(r.from), Math.abs(r.to));
  const to = Math.max(Math.abs(r.from), Math.abs(r.to));
  if (percent > to) return "fast";
  if (percent < from) return "slow";
  return "ok";
}

/** Базовый обмен пригодится экрану для пояснения — держится рядом, чтобы не импортировать дважды. */
export { bmr };
