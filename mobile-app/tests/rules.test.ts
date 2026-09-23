import { eq, test } from "./harness";
import { describeDayRule, normalizeDayRule, requiredForDay } from "../src/lib/dayRule";
import { capQuota, meetsQuota, normalizeLevelRule, shortfall } from "../src/lib/level";
import { isDayOff, normalizeDayOff } from "../src/lib/dayOff";
import { habitTarget, logCount, perDayTarget } from "../src/lib/habits";
import { habit } from "./fixtures";

test("сколько привычек закрыть", () => {
  eq("все", requiredForDay({ kind: "all" }, 4), 4);
  eq("две", requiredForDay({ kind: "count", value: 2 }, 4), 2);
  eq("больше, чем есть, — сколько есть", requiredForDay({ kind: "count", value: 9 }, 4), 4);
  eq("процент вверх", requiredForDay({ kind: "percent", value: 50 }, 3), 2);
  eq("никогда не ноль", requiredForDay({ kind: "percent", value: 10 }, 3), 1);
  eq("пустой список — ноль", requiredForDay({ kind: "all" }, 0), 0);
  eq("мусор — «все»", normalizeDayRule("мусор"), { kind: "all" });
  eq("описание с урезанием", describeDayRule({ kind: "count", value: 5 }, 3), "5 в день, а в списке 3 — значит 3 из 3");
});

test("уровни", () => {
  eq("строго по уровням: сложная за лёгкую не идёт",
    meetsQuota({ hard: 2, medium: 0, easy: 0 }, { hard: 0, medium: 0, easy: 1 }), false);
  eq("урезание до того, что есть",
    capQuota({ hard: 3, medium: 1, easy: 0 }, { hard: 1, medium: 5, easy: 2 }), { hard: 1, medium: 1, easy: 0 });
  eq("сколько не хватает", shortfall({ hard: 1, medium: 0, easy: 3 }, { hard: 2, medium: 1, easy: 1 }), { hard: 1, medium: 1, easy: 0 });
  eq("мусор — нули", normalizeLevelRule({ daily: { hard: "два" } }).daily, { hard: 0, medium: 0, easy: 0 });
});

test("выходные", () => {
  const rule = normalizeDayOff({ weekdays: [7, 99], dates: ["2026-09-10", "вчера"] });
  eq("воскресенье", isDayOff("2026-09-20", rule), true);
  eq("понедельник — нет", isDayOff("2026-09-21", rule), false);
  eq("разовый", isDayOff("2026-09-10", rule), true);
  eq("мусор отброшен", rule, { weekdays: [7], dates: ["2026-09-10"] });
});

test("цель привычки", () => {
  eq("без цели — раз в день", habitTarget(habit("a")), { kind: "daily", count: 1 });
  eq("ноль — один", habitTarget(habit("a", { target: { kind: "daily", count: 0 } })).count, 1);
  eq("сорок — двенадцать", habitTarget(habit("a", { target: { kind: "daily", count: 40 } })).count, 12);
  eq("недельная в день — одна", perDayTarget(habit("a", { target: { kind: "weekly", count: 3 } })), 1);
  eq("отметка без счётчика", logCount({ id: "x", habitId: "a", date: "2026-09-01", done: true } as never), 1);
  eq("минус — ноль", logCount({ id: "x", habitId: "a", date: "2026-09-01", done: true, count: -3 } as never), 0);
});
