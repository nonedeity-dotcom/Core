import { plural } from "../plural";
import { periodTitle } from "../goals";
import type { Award } from "./currency";
import type { Difficulty } from "../games/wordsearch";

/**
 * За что и сколько начисляется.
 *
 * Вся механика — одна чистая функция от того, что в приложении уже есть: закрытые дни,
 * лучшая серия, сессии, итоги месяцев, собранные поля. Она не знает, когда её позвали, и не
 * помнит ничего между вызовами — помнит кошелёк, в котором лежат ключи оплаченного.
 *
 * Из этого само собой выходит начисление за прошлое: в первый раз оплаченного нет вовсе, и
 * вся история оплачивается разом. И из этого же выходит защита от двойной оплаты: ключ
 * события один и тот же, сколько раз ни считай.
 */

/** Сколько искр за что. Искры частые: они на то и нужны, чтобы тратить не задумываясь. */
export const SPARKS = {
  day: 10,
  /** За одну фокус-сессию; больше четырёх в день не оплачивается. */
  session: 5,
  maxSessionsPerDay: 4,
  field: { easy: 5, normal: 10, hard: 20 } as Record<Difficulty, number>,
  record: 10,
};

/** Сколько ядер. Ядра редкие: только за крупное и неповторимое. */
export const CORES = {
  milestone: { 7: 1, 14: 2, 30: 5, 66: 20 } as Record<number, number>,
  summary: 3,
  goalDone: 5,
};

/** Что известно приложению на момент подсчёта. */
export interface EarnState {
  /** Даты, которые засчитались как закрытые дни. */
  countedDates: string[];
  /** Сегодняшний день — по нему отсекается то, что ещё может измениться. */
  today: string;
  /** Лучшая серия за всю историю. */
  bestStreak: number;
  /** Сколько фокус-сессий в каждый день. */
  sessionsByDate: Record<string, number>;
  /** Месяцы с написанным итогом. */
  summaries: string[];
  /** Месяцы, у которых цель отмечена целиком. */
  goalsDone: string[];
  /** Сколько полей собрано по каждой сложности. */
  fields: Record<Difficulty, number>;
  /** Ключи «тема:сложность», по которым есть рекорд времени. */
  records: string[];
}

export const MILESTONES = [7, 14, 30, 66];

/**
 * Что причитается по этому состоянию.
 *
 * Возвращается всё подряд, включая давно оплаченное: отсев по ключам делает кошелёк, и он
 * один. Так проще рассуждать — здесь только «за что положено», без «а не платили ли уже».
 */
export function earnedAwards(state: EarnState): Award[] {
  const out: Award[] = [];

  for (const date of state.countedDates) {
    out.push({ key: `day:${date}`, title: "День закрыт", sparks: SPARKS.day, cores: 0 });
  }

  /*
   * Сессии оплачиваются днями, и только законченными.
   *
   * Ключ один на день, а не на сессию: у сессии нет своего опознавательного номера, который
   * пережил бы перезапуск. Значит, оплатить день можно лишь тогда, когда число сессий в нём
   * уже не изменится, — то есть на следующий день. Сегодняшние подождут до завтра.
   */
  for (const [date, count] of Object.entries(state.sessionsByDate)) {
    if (date >= state.today || count <= 0) continue;
    const paid = Math.min(SPARKS.maxSessionsPerDay, count);
    out.push({
      key: `focus:${date}`,
      title: `${paid} ${plural(paid, ["фокус-сессия", "фокус-сессии", "фокус-сессий"])}`,
      sparks: paid * SPARKS.session,
      cores: 0,
    });
  }

  for (const milestone of MILESTONES) {
    if (state.bestStreak < milestone) continue;
    out.push({
      key: `milestone:${milestone}`,
      title: `${milestone} ${plural(milestone, ["день", "дня", "дней"])} подряд`,
      sparks: 0,
      cores: CORES.milestone[milestone] ?? 1,
    });
  }

  for (const period of state.summaries) {
    out.push({
      key: `summary:${period}`,
      title: `Итог за ${periodTitle(period).toLowerCase()}`,
      sparks: 0,
      cores: CORES.summary,
    });
  }

  for (const period of state.goalsDone) {
    out.push({
      key: `goal:${period}`,
      title: `Цель за ${periodTitle(period).toLowerCase()} закрыта`,
      sparks: 0,
      cores: CORES.goalDone,
    });
  }

  /*
   * Поля считаются штуками, а не событиями: игра хранит счётчик, а не список партий. Ключ на
   * каждую по счёту — «пятое лёгкое поле» — и оплачивается она один раз навсегда.
   */
  for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
    for (let n = 1; n <= (state.fields[difficulty] ?? 0); n++) {
      out.push({
        key: `field:${difficulty}:${n}`,
        title: "Поле собрано",
        sparks: SPARKS.field[difficulty],
        cores: 0,
      });
    }
  }

  for (const key of state.records) {
    out.push({ key: `record:${key}`, title: "Рекорд в игре", sparks: SPARKS.record, cores: 0 });
  }

  return out;
}

/** Сколько всего причитается — для строки «начислено» после долгого перерыва. */
export function sumAwards(awards: Award[]): { sparks: number; cores: number } {
  return {
    sparks: awards.reduce((n, a) => n + a.sparks, 0),
    cores: awards.reduce((n, a) => n + a.cores, 0),
  };
}
