/**
 * Норма, проверенная весами, а не формулой.
 *
 * Любой счётчик калорий показывает число из формулы, и все они показывают разные: у одной
 * и той же анкеты Миффлин, Харрис — Бенедикт и коэффициент активности дают разброс в
 * шестьсот-семьсот килокалорий. Спор о том, какая формула вернее, бессмысленный: неизвестен
 * не коэффициент, а расход конкретного человека, и ни одна анкета его не измеряет. Формула
 * ошибается на ±10 % даже при верной активности, а сама активность — это то, что человек
 * про себя предположил.
 *
 * Проверить можно ровно одним способом: есть известное количество, смотреть на весы и
 * считать. Если за три недели при 2600 ккал вес прибавил 0,2 кг в неделю — расход равен
 * 2600 минус то, что ушло в прибавку, и это уже не оценка, а измерение.
 *
 * Модуль ничего не знает ни про экраны, ни про хранилище: на входе средние калории и тренд
 * веса, на выходе — вывод и поправка. Поэтому его можно гонять в node на выдуманных
 * дневниках, включая те, что в жизни ждать три недели.
 */

import type { Goal, Profile } from "./profile";

/**
 * Сколько калорий стоит килограмм веса.
 *
 * Семь тысяч семьсот — это про жир; набранная мышца дешевле, зато тянет за собой воду.
 * Число приблизительное и другим быть не может, поэтому и поправка округляется до полусотни,
 * а не выдаёт «плюс 237 ккал» с видом точного расчёта.
 */
export const KCAL_PER_KG = 7700;

/**
 * С какой скоростью цель должна двигать вес — в процентах от веса тела за неделю.
 *
 * В процентах, а не в килограммах: полкило в неделю для человека в пятьдесят килограммов и
 * для человека в сто — это две разные истории. Набирать быстрее верхней границы означает
 * набирать жиром, худеть быстрее — терять мышцы вместе с жиром.
 */
export const RATE_PERCENT: Record<Goal, { from: number; to: number }> = {
  gain: { from: 0.25, to: 0.5 },
  keep: { from: -0.15, to: 0.15 },
  lose: { from: -1.0, to: -0.5 },
};

/** Целевой темп в килограммах в неделю — то, с чем сравнивают весы. */
export function targetRate(p: Profile): { from: number; to: number; mid: number } {
  const r = RATE_PERCENT[p.goal];
  const from = (p.weightKg * r.from) / 100;
  const to = (p.weightKg * r.to) / 100;
  return { from, to, mid: (from + to) / 2 };
}

/** Дневная поправка калорий, дающая нужный сдвиг темпа. */
const kcalForRate = (kgPerWeek: number): number => (kgPerWeek * KCAL_PER_KG) / 7;

/**
 * Стартовая надбавка к расходу под цель.
 *
 * Раньше здесь стояло ровное ±400 для всех. Для человека в пятьдесят килограммов это
 * прибавка почти в процент веса за неделю — то есть заведомо мимо цели, жиром. Теперь
 * надбавка считается из того же темпа, которым потом мерят результат: одна модель на старт и
 * на проверку, а не две разные.
 */
export function goalShift(p: Profile): number {
  return Math.round(kcalForRate(targetRate(p).mid) / 10) * 10;
}

/** Сколько дней должно пройти, прежде чем у весов появится право голоса. */
export const MIN_DAYS = 14;
/** Сколько дней из них должны быть записаны: среднее по трём дням — это не среднее. */
export const MIN_LOGGED_SHARE = 0.6;
/** Сколько взвешиваний нужно. Двух мало: вес за сутки гуляет на килограмм от воды. */
export const MIN_WEIGHTS = 4;
/** Дальше какой поправки за раз не уходим: одна шумная неделя не должна двигать норму втрое. */
export const MAX_SHIFT = 500;

export type Verdict = "on-track" | "too-slow" | "too-fast" | "wrong-way";

export interface Calibration {
  days: number;
  daysLogged: number;
  /** Среднее съеденное за дни с записями. */
  eatenAvg: number;
  /** Куда идёт вес, кг в неделю. */
  actualRate: number;
  /** Куда он должен идти при этой цели. */
  wantFrom: number;
  wantTo: number;
  /**
   * Расход, посчитанный по факту: съедено минус то, что ушло в прибавку веса.
   *
   * Это и есть ответ на вопрос «сколько я на самом деле трачу», которого нет ни в одной
   * формуле.
   */
  measuredTdee: number;
  /** На сколько сдвинуть дневную норму. Ноль — ничего менять не надо. */
  shiftKcal: number;
  verdict: Verdict;
}

export type CalibrationState =
  /** Данных пока не хватает — и сказано, каких именно. */
  | { status: "waiting"; needDays: number; needWeights: number; needLogged: number }
  /** Поправку уже приняли, и новых данных с тех пор ещё мало. */
  | { status: "settling"; daysLeft: number; adjustKcal: number }
  | { status: "ready"; data: Calibration };

export interface CalibrationInput {
  profile: Profile;
  days: number;
  daysLogged: number;
  eatenAvg: number;
  /** Из `weightTrend`: килограммы в неделю и сколько взвешиваний за ним стоит. */
  ratePerWeek: number | null;
  weighIns: number;
  /**
   * Сколько дней прошло с прошлой поправки, или null, если её не было.
   *
   * Приняв поправку, человек изменил условия опыта. Считать по данным, собранным до неё, и
   * предлагать вторую поправку поверх первой — значит дважды исправить одну и ту же ошибку.
   */
  daysSinceAdjust?: number | null;
}

/**
 * Что говорят весы про норму.
 *
 * Молчит, пока данных мало, и молчит внятно: не «недостаточно данных», а сколько ещё дней,
 * записей и взвешиваний нужно. Иначе экран выглядит сломанным, а он просто честен.
 */
export function calibrate(input: CalibrationInput): CalibrationState {
  const { profile, days, daysLogged, eatenAvg, ratePerWeek, weighIns, daysSinceAdjust } = input;

  // Поправка только что принята: весы ещё не успели ответить на неё.
  if (typeof daysSinceAdjust === "number" && daysSinceAdjust < MIN_DAYS) {
    return {
      status: "settling",
      daysLeft: MIN_DAYS - daysSinceAdjust,
      adjustKcal: profile.adjustKcal ?? 0,
    };
  }

  const needDays = Math.max(0, MIN_DAYS - days);
  const needWeights = Math.max(0, MIN_WEIGHTS - weighIns);
  const needLogged = Math.max(0, Math.ceil(MIN_DAYS * MIN_LOGGED_SHARE) - daysLogged);

  if (needDays > 0 || needWeights > 0 || needLogged > 0 || ratePerWeek === null || eatenAvg <= 0) {
    return {
      status: "waiting",
      needDays,
      needWeights,
      // Взвешиваний нет вовсе — тренда нет, сколько бы дней ни прошло.
      needLogged: ratePerWeek === null && needWeights === 0 ? Math.max(needLogged, 1) : needLogged,
    };
  }

  const want = targetRate(profile);
  // Расход по факту: съедал столько-то, из них столько-то ушло в вес — остальное потратил.
  const measuredTdee = Math.round(eatenAvg - kcalForRate(ratePerWeek));

  const verdict: Verdict =
    ratePerWeek >= want.from && ratePerWeek <= want.to
      ? "on-track"
      : // Движется не туда, куда цель: набор при похудении и наоборот. Отдельный случай,
        // потому что человеку это надо сказать другими словами, чем «медленновато».
        profile.goal !== "keep" && Math.sign(ratePerWeek) === -Math.sign(want.mid) && ratePerWeek !== 0
        ? "wrong-way"
        : ratePerWeek < want.from
          ? profile.goal === "lose"
            ? "too-fast"
            : "too-slow"
          : profile.goal === "lose"
            ? "too-slow"
            : "too-fast";

  // Поправка ведёт к середине диапазона, а не к его краю: у края любая следующая неделя
  // снова выбьет из него.
  const raw = verdict === "on-track" ? 0 : kcalForRate(want.mid - ratePerWeek);
  const shiftKcal = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.round(raw / 50) * 50));

  return {
    status: "ready",
    data: {
      days,
      daysLogged,
      eatenAvg: Math.round(eatenAvg),
      actualRate: Math.round(ratePerWeek * 100) / 100,
      wantFrom: Math.round(want.from * 100) / 100,
      wantTo: Math.round(want.to * 100) / 100,
      measuredTdee,
      shiftKcal,
      verdict,
    },
  };
}
