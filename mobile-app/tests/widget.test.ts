import { eq, test } from "./harness";
import { parseTaps, tapsToApply, widgetSnapshot } from "../src/lib/widget";
import type { Habit, HabitLog } from "../src/types";

const T = "2026-09-23";
const habits: Habit[] = [
  { id: "b", label: "Вода", sortOrder: 1, target: { kind: "daily", count: 3 } },
  { id: "a", label: "Зарядка", sortOrder: 0 },
  { id: "x", label: "Потом", sortOrder: 2, group: "later" },
  { id: "e", label: "Дополнительно", sortOrder: 3, group: "extra" },
  { id: "s", label: "Не сидеть в TikTok", sortOrder: 4, auto: "screentime" },
  { id: "old", label: "В архиве", sortOrder: 5, archivedAt: "2026-09-01T10:00:00Z" },
  { id: "w", label: "Спорт", sortOrder: 6, target: { kind: "weekly", count: 3 } },
];
const logs: HabitLog[] = [
  { id: "1", habitId: "b", date: T, done: false, count: 2 },
  { id: "2", habitId: "a", date: "2026-09-22", done: true, count: 1 },
  { id: "3", habitId: "s", date: T, done: true },
];

test("слепок для виджета", () => {
  const snap = widgetSnapshot(habits, logs, T);
  eq("только «Ввожу сейчас», по порядку, без архива", snap.habits.map((h) => h.id), ["a", "b", "s", "w"]);
  eq("счётчик и цель", snap.habits.find((h) => h.id === "b"), { id: "b", label: "Вода", count: 2, target: 3, auto: false });
  eq("вчерашняя отметка не в счёт", snap.habits.find((h) => h.id === "a")?.count, 0);
  eq("экранная помечена и отмечена по старой строке", snap.habits.find((h) => h.id === "s"), {
    id: "s", label: "Не сидеть в TikTok", count: 1, target: 1, auto: true,
  });
  eq("недельная — одно нажатие в день", snap.habits.find((h) => h.id === "w")?.target, 1);
  eq("дата", snap.date, T);
});

test("очередь нажатий", () => {
  eq("мусор — пусто", parseTaps("не json"), []);
  eq("не список — пусто", parseTaps('{"id":"a"}'), []);
  eq("кривые выброшены", parseTaps(JSON.stringify([{ id: "a", date: T }, { id: "", date: T }, { id: "b" }, { id: "c", date: "вчера" }, 5])), [
    { id: "a", date: T },
  ]);
  const todo = tapsToApply(
    [{ id: "a", date: T }, { id: "b", date: T }, { id: "b", date: T }, { id: "s", date: T }, { id: "old", date: T }, { id: "gone", date: T }],
    habits,
  );
  eq("каждое нажатие — шаг; экранные, архив и удалённые — мимо", todo.map((t) => t.habit.id), ["a", "b", "b"]);
});
