import { eq, ok, test } from "./harness";
import {
  carryItems,
  daysInMonth,
  goalProgress,
  kindOf,
  monthKey,
  normalizeGoals,
  periodGenitive,
  prevMonth,
  stepItem,
  summaryDue,
  toggleItem,
  yearKey,
  type PeriodGoal,
} from "../src/lib/goals";

const goal = (period: string, extra: Partial<PeriodGoal> = {}): PeriodGoal => ({
  period,
  kind: kindOf(period),
  main: "",
  items: [],
  summary: "",
  summaryDate: "",
  updatedAt: "",
  ...extra,
}) as PeriodGoal;

test("периоды", () => {
  eq("месяц", monthKey("2026-09-23"), "2026-09");
  eq("год", yearKey("2026-09-23"), "2026");
  eq("вид", [kindOf("2026-09"), kindOf("2026")], ["month", "year"]);
  eq("январь → декабрь прошлого года", prevMonth("2026-01"), "2025-12");
  eq("високосный февраль", daysInMonth("2028-02"), 29);
  eq("родительный", periodGenitive("2026-08"), "августа");
});

test("пункты со счётчиком", () => {
  const g = goal("2026-09", { items: [{ id: "i", text: "зал", done: false, target: 12, count: 11 }] });
  const once = toggleItem(g, "i");
  eq("нажатие добавляет", once.items[0].count, 12);
  eq("и упирается в цель", toggleItem(once, "i").items[0].count, 12);
  eq("убавление — отдельно и не ниже нуля", stepItem(goal("2026-09", { items: [{ id: "i", text: "зал", done: false, target: 12, count: 0 }] }), "i", -1).items[0].count, 0);
  eq("прогресс", goalProgress(once), { done: 1, total: 1 });
});

test("перенос хвостов", () => {
  const g = goal("2026-08", {
    items: [
      { id: "1", text: "сделано", done: true },
      { id: "2", text: "хвост", done: false },
    ],
  });
  const carried = carryItems(g);
  eq("только невыполненное", carried.map((i) => i.text), ["хвост"]);
  ok("с новым id — старый месяц не трогается", carried[0].id !== "2");
});

test("когда просить итог", () => {
  const aug = goal("2026-08", { main: "бегать" });
  eq("прошлый месяц с целью и без итога — первым", summaryDue([aug], "2026-09-10"), "2026-08");
  eq("с итогом — нет", summaryDue([{ ...aug, summary: "бегал" }], "2026-09-10"), null);
  eq("нынешний — только под конец", summaryDue([], "2026-09-29"), "2026-09");
  eq("десятого числа — нет", summaryDue([], "2026-09-10"), null);
});

test("мусор из хранилища", () => {
  const list = normalizeGoals([goal("2026-09", { main: "цель" }), { period: 7 }, "мусор", null]);
  eq("остаётся только целое", list.map((g) => g.period), ["2026-09"]);
});
