import { eq, test } from "./harness";
import { ago, allDone, habit, mark } from "./fixtures";
import { computeStreak, countedDates, dayCounts, freezeCandidate, streakSpan } from "../src/lib/streak";
import { DEFAULT_DAY_RULE } from "../src/lib/dayRule";
import { DEFAULT_LEVEL_RULE, type LevelRule } from "../src/lib/level";
import { DEFAULT_SKIP_RULE } from "../src/lib/skipRule";
import { dayOfWeek } from "../src/lib/week";

const R = DEFAULT_DAY_RULE;
const L = DEFAULT_LEVEL_RULE;
const a = habit("a");
const b = habit("b");
const d = ago(3);

test("день закрыт, когда закрыты все привычки из «ввожу сейчас»", () => {
  eq("обе — закрыт", dayCounts([a, b], [mark("a", d), mark("b", d)], d, R, L), true);
  eq("одна — нет", dayCounts([a, b], [mark("a", d)], d, R, L), false);
});

test("кто день не решает", () => {
  const extra = habit("x", { group: "extra" });
  const later = habit("l", { group: "later" });
  const weekly = habit("w", { target: { kind: "weekly", count: 3 } });
  eq("«дополнительно», «потом» и недельная не мешают", dayCounts([a, extra, later, weekly], [mark("a", d)], d, R, L), true);
  const fresh = habit("f", { createdAt: ago(1) });
  eq("привычка, заведённая позже, прошлое не судит", dayCounts([a, fresh], [mark("a", d)], d, R, L), true);
  const back = habit("r", { createdAt: ago(100), nowSince: ago(1) });
  eq("вернувшаяся в список — тоже", dayCounts([a, back], [mark("a", d)], d, R, L), true);
  eq("пустой список — дня нет", dayCounts([habit("x", { group: "extra" })], [mark("x", d)], d, R, L), false);
});

test("счётчик: «3 раза в день» — это три отметки", () => {
  const thrice = habit("t", { target: { kind: "daily", count: 3 } });
  eq("две из трёх — не закрыт", dayCounts([thrice], [mark("t", d, 2)], d, R, L), false);
  eq("три — закрыт", dayCounts([thrice], [mark("t", d, 3)], d, R, L), true);
  const old = { id: "o", habitId: "a", date: d, done: true } as never;
  eq("старая запись без счётчика — одна отметка", dayCounts([a], [old], d, R, L), true);
});

test("правило дня", () => {
  const c = habit("c");
  const logs = [mark("a", d), mark("b", d)];
  eq("2 из 3 при «двух»", dayCounts([a, b, c], logs, d, { kind: "count", value: 2 }, L), true);
  eq("2 из 3 при 70%", dayCounts([a, b, c], logs, d, { kind: "percent", value: 70 }, L), false);
  eq("«пять», а в списке три — нужны все три", dayCounts([a, b, c], logs, d, { kind: "count", value: 5 }, L), false);
});

test("норма по уровням", () => {
  const hard = habit("h", { level: "hard" });
  const easy = habit("e", { level: "easy" });
  const quota: LevelRule = { daily: { hard: 1, medium: 0, easy: 0 }, weekly: { hard: 0, medium: 0, easy: 0 } };
  const rule = { kind: "count" as const, value: 1 };
  eq("закрыта лёгкая — сложной нет", dayCounts([hard, easy], [mark("e", d)], d, rule, quota), false);
  eq("закрыта сложная", dayCounts([hard, easy], [mark("h", d)], d, rule, quota), true);
  const two: LevelRule = { daily: { hard: 2, medium: 0, easy: 0 }, weekly: quota.weekly };
  eq("две сложных при одной — норма урезается", dayCounts([hard, easy], [mark("h", d)], d, rule, two), true);
});

test("одним проходом — то же, что по дню", () => {
  const logs = [...allDone([a, b], [1, 2, 4]), mark("a", ago(3))];
  const set = countedDates([a, b], logs, R, L);
  for (const n of [1, 2, 3, 4]) eq(`день ${n}`, set.has(ago(n)), dayCounts([a, b], logs, ago(n), R, L));
});

test("серия", () => {
  eq("пять дней с сегодняшним", computeStreak([a], allDone([a], [0, 1, 2, 3, 4]), [], R, L), 5);
  eq("сегодня ещё не отмечено — серия не рвётся", computeStreak([a], allDone([a], [1, 2, 3]), [], R, L), 3);
  eq("вчера пропуск — серия с нуля", computeStreak([a], allDone([a], [0, 2, 3]), [], R, L), 1);
  eq("вчера заморожено — цепочка держится, но не растёт", computeStreak([a], allDone([a], [0, 2, 3]), [ago(1)], R, L), 3);
  const weekday = dayOfWeek(ago(1));
  eq("вчера выходной — так же", computeStreak([a], allDone([a], [0, 2, 3]), [], R, L, { weekdays: [weekday], dates: [] }), 3);
  eq("пустой список — серии нет", computeStreak([], [], [], R, L), 0);
});

test("длина цепочки считает и пропуски", () => {
  const span = streakSpan([a], allDone([a], [0, 2, 3]), [ago(1)], R, L);
  eq("четыре календарных дня, три сделано, один заморожен", span, { days: 4, done: 3, frozen: 1, off: 0 });
});

test("какой день прикрыть шансом", () => {
  const budget = { ...DEFAULT_SKIP_RULE, shared: { ...DEFAULT_SKIP_RULE.shared, count: 1 } };
  const today = ago(0);
  eq("вчера пропуск, позавчера сделано — вчера", freezeCandidate([a], allDone([a], [2, 3]), [], today, R, L, budget), ago(1));
  eq("без запаса — никакой", freezeCandidate([a], allDone([a], [2, 3]), [], today, R, L, { ...budget, shared: { ...budget.shared, count: 0 } }), null);
  eq("вчера сделано — прикрывать нечего", freezeCandidate([a], allDone([a], [1, 2]), [], today, R, L, budget), null);
  eq("позавчера тоже пропуск — цепочка уже порвана", freezeCandidate([a], allDone([a], [3, 4]), [], today, R, L, budget), null);
  eq("два подряд не прикрыть никаким запасом",
    freezeCandidate([a], allDone([a], [3, 4]), [ago(2)], today, R, L, { ...budget, shared: { ...budget.shared, count: 5 } }), null);
});
