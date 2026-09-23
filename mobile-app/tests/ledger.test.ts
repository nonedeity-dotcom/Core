import { eq, ok, test } from "./harness";
import { applyAwards, EMPTY_PURSE, type Purse } from "../src/lib/rewards/currency";
import { earnedAwards, type EarnState } from "../src/lib/rewards/earn";
import {
  earliest,
  effective,
  paidDates,
  screenHabitDates,
  settle,
  type Verdicts,
} from "../src/lib/rewards/ledger";
import { streakSummary } from "../src/lib/stats";
import { DEFAULT_DAY_OFF } from "../src/lib/dayOff";
import { shiftDate } from "../src/lib/date";
import type { Habit, HabitLog } from "../src/types";

/**
 * Один проход начисления — ровно так, как его делает useRewards, только без React.
 *
 * Если useRewards когда-нибудь начнёт считать иначе, эта копия разойдётся с ним, — поэтому
 * она держится короткой и повторяет его шаг в шаг: рассчитать журнал, собрать итог,
 * оплатить новое.
 */
function pass(purse: Purse, verdicts: Verdicts, today: string): Purse {
  const seed = { closed: paidDates(purse.paid, "day"), screen: paidDates(purse.paid, "screen") };
  const ledger = settle(purse.ledger, verdicts, today, seed);
  const all = effective(ledger, verdicts);
  const streak = streakSummary(all.closed, [...all.rest], earliest(ledger, verdicts), today, DEFAULT_DAY_OFF);
  const state: EarnState = {
    countedDates: [...all.closed].sort(),
    today,
    bestStreak: streak.best,
    sessionsByDate: {},
    summaries: [],
    goalsDone: [],
    fields: { easy: 0, normal: 0, hard: 0 },
    records: [],
    mealDates: [],
    weightDates: [],
    screenDates: [...all.screen].sort(),
    wheelLevels: 0,
    wheelBonus: 0,
  };
  return applyAwards({ ...purse, ledger }, earnedAwards(state), today);
}

const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));
const verdicts = (closed: string[], extra: Partial<Verdicts> = {}): Verdicts => ({
  from: "2026-08-01",
  closed: new Set(closed),
  rest: new Set(),
  screen: new Set(),
  ...extra,
});

const TODAY = "2026-09-23";

test("первый расчёт оплачивает всё прошлое", () => {
  const p = pass(EMPTY_PURSE, verdicts(range("2026-09-01", 10)), TODAY);
  eq("десять дней по десять искр", p.wallet.sparks, 100);
  eq("и веха за неделю", p.wallet.cores, 1);
  eq("журнал рассчитан до позавчера", p.ledger.through, "2026-09-21");
});

test("смена правила задним числом не доплачивает", () => {
  // Было: закрыты 10 дней, серия 10. Понизили планку — прошлые дни 11–20 тоже стали закрытыми.
  const before = pass(EMPTY_PURSE, verdicts(range("2026-09-01", 10)), TODAY);
  const after = pass(before, verdicts(range("2026-09-01", 20)), TODAY);
  eq("искр ровно столько же", after.wallet.sparks, before.wallet.sparks);
  eq("ядер ровно столько же — вехи за 14 не появилось", after.wallet.cores, before.wallet.cores);
});

test("то же с выходными: объявить прошлые дни выходными ничего не даёт", () => {
  // Две недели с дырой посередине. Потом дыру объявили выходным — серия стала бы 14.
  const days = [...range("2026-09-01", 7), ...range("2026-09-09", 7)];
  const before = pass(EMPTY_PURSE, verdicts(days), TODAY);
  const after = pass(before, verdicts(days, { rest: new Set(["2026-09-08"]) }), TODAY);
  eq("вехи за 14 нет", after.wallet.cores, before.wallet.cores);
});

test("открытые дни судятся по нынешним правилам", () => {
  const before = pass(EMPTY_PURSE, verdicts(range("2026-09-01", 10)), TODAY);
  // Вчера ещё открыто: отметил поздно — и его оплатили.
  const after = pass(before, verdicts([...range("2026-09-01", 10), "2026-09-22"]), TODAY);
  eq("вчерашний день оплачен", after.wallet.sparks - before.wallet.sparks, 10);
});

test("назавтра вчерашний день закрывается и больше не меняется", () => {
  const day1 = pass(EMPTY_PURSE, verdicts(["2026-09-20"]), "2026-09-21");
  eq("20-е ещё открыто", day1.ledger.through, "2026-09-19");
  const day3 = pass(day1, verdicts(["2026-09-20"]), "2026-09-23");
  eq("а через два дня уже рассчитано", day3.ledger.through, "2026-09-21");
  ok("и лежит в журнале", day3.ledger.closed.includes("2026-09-20"));
  // Правило поменяли так, что 20-е больше не закрыто, — оно остаётся закрытым в журнале.
  const later = pass(day3, verdicts([]), "2026-09-24");
  ok("вердикт не отозван", later.ledger.closed.includes("2026-09-20"));
});

test("старый кошелёк без журнала сохраняет прежние вердикты", () => {
  // Кошелёк до журнала: 5-е когда-то оплачено как закрытое, а по нынешнему правилу оно не закрыто.
  const old: Purse = { ...EMPTY_PURSE, paid: ["day:2026-09-05"], wallet: { sparks: 10, cores: 0 } };
  const p = pass(old, verdicts(["2026-09-06"]), TODAY);
  ok("5-е в журнале — вердикт тот, что был", p.ledger.closed.includes("2026-09-05"));
  eq("а оплачено только новое 6-е", p.wallet.sparks, 20);
});

test("серия, выпавшая из окна, остаётся в журнале", () => {
  const long = range("2026-01-01", 66);
  const first = pass(EMPTY_PURSE, verdicts(long, { from: "2026-01-01" }), TODAY);
  eq("за 66 дней — все вехи: 1+2+5+20", first.wallet.cores, 28);
  // Окно сдвинулось, и январь в него больше не попадает.
  const later = pass(first, verdicts([], { from: "2026-06-01" }), TODAY);
  const all = effective(later.ledger, verdicts([], { from: "2026-06-01" }));
  const streak = streakSummary(all.closed, [...all.rest], earliest(later.ledger, verdicts([], { from: "2026-06-01" })), TODAY, DEFAULT_DAY_OFF);
  eq("лучшая серия по-прежнему 66", streak.best, 66);
});

test("кошелёк не теряет своих полей при начислении", () => {
  const p = pass(
    { ...EMPTY_PURSE, owned: ["palette-ember"], meltedAt: "2026-09-20", equipped: { palette: "palette-ember", accent: "accent-sky", title: "t-week" } },
    verdicts(["2026-09-10"]),
    TODAY,
  );
  eq("купленное на месте", p.owned, ["palette-ember"]);
  eq("надетое на месте", p.equipped.accent, "accent-sky");
  eq("переплавка на месте", p.meltedAt, "2026-09-20");
});

const habit = (id: string, extra: Partial<Habit> = {}): Habit =>
  ({ id, label: id, sortOrder: 0, ...extra }) as Habit;
const done = (habitId: string, date: string): HabitLog => ({ id: `${habitId}-${date}`, habitId, date, done: true }) as HabitLog;
const rule = { app: ".total", limitMin: 60 };

test("экранный день — когда удержались все экранные привычки", () => {
  const habits = [habit("a", { auto: "screentime", screen: rule }), habit("b", { auto: "screentime", screen: rule }), habit("c")];
  const logs = [done("a", "2026-09-10"), done("b", "2026-09-10"), done("a", "2026-09-11"), done("c", "2026-09-12")];
  eq("обе удержались только 10-го", [...screenHabitDates(habits, logs)], ["2026-09-10"]);
});

test("привычка, которой ещё не было, день не портит", () => {
  const habits = [habit("a", { auto: "screentime", screen: rule }), habit("b", { auto: "screentime", screen: rule, createdAt: "2026-09-15" })];
  const logs = [done("a", "2026-09-10"), done("a", "2026-09-16")];
  eq("10-го «b» ещё не было, 16-го «b» не удержалась", [...screenHabitDates(habits, logs)], ["2026-09-10"]);
});

test("без экранных привычек экранных дней нет", () => {
  eq("пусто", [...screenHabitDates([habit("c")], [done("c", "2026-09-10")])], []);
});

test("«не меньше» в награду за экран не входит", () => {
  const habits = [
    habit("limit", { auto: "screentime", screen: rule }),
    habit("reader", { auto: "screentime", screen: { app: "com.reader", limitMin: 20, direction: "atLeast" } }),
  ];
  // Читалку не открывал, но лимит удержал — день экранный: награда про отказ от экрана.
  eq("засчитан по лимиту", [...screenHabitDates(habits, [done("limit", "2026-09-10")])], ["2026-09-10"]);
  const onlyReader = [habit("reader", { auto: "screentime", screen: { app: "com.reader", limitMin: 20, direction: "atLeast" } })];
  eq("одна «не меньше» — экранных дней нет", [...screenHabitDates(onlyReader, [done("reader", "2026-09-10")])], []);
});
