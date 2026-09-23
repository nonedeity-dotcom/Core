import { eq, test } from "./harness";
import {
  FRESHNESS_TOLERANCE_MS,
  decideRule,
  TOTAL_APP,
  decideScreenTimeHabit,
  decideUsage,
  endOfLocalDay,
  isTotal,
  normalizeScreenRule,
} from "../src/lib/screenTime";

const DAY = "2026-09-21";
const END = endOfLocalDay(DAY);
const NOW = END + 6 * 60 * 60 * 1000; // утро следующего дня
const H = 3600000;

test("превысил — видно по любой строке", () => {
  eq("отставшая", decideUsage(6 * H, 0, 300, NOW, DAY), { action: "tick", withinLimit: false });
  eq("свежая", decideUsage(6 * H, END, 300, NOW, DAY), { action: "tick", withinLimit: false });
});

test("уложился — только по домеренному дню", () => {
  eq("домерен", decideUsage(2 * H, END, 300, NOW, DAY), { action: "tick", withinLimit: true });
  eq("без отметки", decideUsage(2 * H, 0, 300, NOW, DAY), { action: "skip", reason: "incomplete" });
  eq("creker отстал", decideUsage(2 * H, END - FRESHNESS_TOLERANCE_MS - 60000, 300, NOW, DAY), {
    action: "skip",
    reason: "incomplete",
  });
});

test("граница лимита", () => {
  eq("ровно лимит — уложился", decideUsage(5 * H, END, 300, NOW, DAY), { action: "tick", withinLimit: true });
  eq("минутой больше — нет", decideUsage(5 * H + 60000, END, 300, NOW, DAY), { action: "tick", withinLimit: false });
  eq("не открывал вовсе — это ответ", decideUsage(0, END, 60, NOW, DAY), { action: "tick", withinLimit: true });
});

test("старый вход ведёт себя как новый", () => {
  eq("без строки — сказать нечего", decideScreenTimeHabit(undefined, 300, NOW, DAY), { action: "skip", reason: "no-data" });
  eq(
    "то же решение",
    decideScreenTimeHabit({ screenMillis: 2 * H, updatedAt: END }, 300, NOW, DAY),
    decideUsage(2 * H, END, 300, NOW, DAY),
  );
});

test("правило из резервной копии", () => {
  eq("всё экранное время", isTotal({ app: TOTAL_APP, limitMin: 60 }), true);
  eq("пакет — не всё время", isTotal({ app: "com.zhiliaoapp.musically", limitMin: 60 }), false);
  eq("мусор не правило", normalizeScreenRule({ app: 7, limitMin: 60 }), null);
  eq("без лимита не правило", normalizeScreenRule({ app: "com.x" }), null);
  eq("лимит режется по потолку", normalizeScreenRule({ app: "com.x", limitMin: 99999 })?.limitMin, 16 * 60);
  eq("пустое имя отбрасывается", normalizeScreenRule({ app: "com.x", label: "", limitMin: 30 }), { app: "com.x", limitMin: 30 });
});

const atLeast = { app: "com.reader", limitMin: 20, direction: "atLeast" as const };
const TODAY_NOON = END - 12 * H; // полдень того же дня

test("«не меньше»: набрал — отмечается сразу, в любой момент дня", () => {
  eq("в полдень, по отставшей строке", decideRule(atLeast, 25 * 60000, 0, TODAY_NOON, DAY), { action: "tick", done: true });
  eq("ровно планка — набрано", decideRule(atLeast, 20 * 60000, END, NOW, DAY), { action: "tick", done: true });
});

test("«не меньше»: не набрал — только про законченный день", () => {
  eq("в полдень рано судить", decideRule(atLeast, 5 * 60000, TODAY_NOON, TODAY_NOON, DAY), { action: "skip", reason: "incomplete" });
  eq("назавтра, день домерен — не набрал", decideRule(atLeast, 5 * 60000, END, NOW, DAY), { action: "tick", done: false });
  eq("назавтра, но день не домерен — молчим", decideRule(atLeast, 5 * 60000, END - FRESHNESS_TOLERANCE_MS - 60000, NOW, DAY), {
    action: "skip",
    reason: "incomplete",
  });
});

test("«не больше» через общий вход — как раньше", () => {
  const atMost = { app: TOTAL_APP, limitMin: 300 };
  eq("уложился", decideRule(atMost, 2 * H, END, NOW, DAY), { action: "tick", done: true });
  eq("превысил", decideRule(atMost, 6 * H, 0, NOW, DAY), { action: "tick", done: false });
  eq("не домерен", decideRule(atMost, 2 * H, 0, NOW, DAY), { action: "skip", reason: "incomplete" });
});

test("сторона правила в резервной копии", () => {
  eq("«не меньше» переносится", normalizeScreenRule({ app: "com.x", limitMin: 20, direction: "atLeast" })?.direction, "atLeast");
  eq("«не больше» — без поля, как было всегда", normalizeScreenRule({ app: "com.x", limitMin: 20, direction: "atMost" }), { app: "com.x", limitMin: 20 });
  eq("мусор — «не больше»", normalizeScreenRule({ app: "com.x", limitMin: 20, direction: "вбок" }), { app: "com.x", limitMin: 20 });
});
