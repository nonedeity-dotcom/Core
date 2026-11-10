import { eq, ok, test } from "./harness";
import {
  DAY_NOTE_MAX,
  isDateKey,
  mergeNotes,
  monthOf,
  monthTitle,
  monthWeeks,
  normalizeNote,
  normalizeNotes,
  previewOf,
  shiftMonth,
} from "../src/lib/dayNotes";

const note = (date: string, text: string, updatedAt = "2026-11-01T10:00:00.000Z") => ({ date, text, updatedAt });

test("isDateKey: настоящие даты — да, невозможные — нет", () => {
  ok("обычный день", isDateKey("2026-11-10"));
  ok("29 февраля високосного", isDateKey("2028-02-29"));
  ok("29 февраля невисокосного — нет", !isDateKey("2026-02-29"));
  ok("31 апреля — нет", !isDateKey("2026-04-31"));
  ok("13-й месяц — нет", !isDateKey("2026-13-01"));
  ok("нулевой день — нет", !isDateKey("2026-11-00"));
  ok("не та форма — нет", !isDateKey("2026-1-1") && !isDateKey("10.11.2026") && !isDateKey(20261110));
});

test("normalizeNote: текст обрезается по краям, пустое и негодное выпадает", () => {
  eq("пробелы по краям", normalizeNote(note("2026-11-10", "  день удался \n"))?.text, "день удался");
  eq("пустой итог — не запись", normalizeNote(note("2026-11-10", "   \n ")), null);
  eq("нет даты", normalizeNote({ text: "x", updatedAt: "2026-11-01T10:00:00.000Z" }), null);
  eq("дата невозможная", normalizeNote(note("2026-02-31", "x")), null);
  eq("текст не строка", normalizeNote({ date: "2026-11-10", text: 5 }), null);
  eq("не объект", normalizeNote("итог"), null);
  eq("null", normalizeNote(null), null);
});

test("normalizeNote: слишком длинный текст режется по потолку", () => {
  const long = "а".repeat(DAY_NOTE_MAX + 500);
  eq("длина после обрезки", normalizeNote(note("2026-11-10", long))?.text.length, DAY_NOTE_MAX);
});

test("normalizeNote: нет или испорчена метка времени — подставляется самая ранняя", () => {
  eq("без updatedAt", normalizeNote({ date: "2026-11-10", text: "x" })?.updatedAt, new Date(0).toISOString());
  eq("мусор вместо updatedAt", normalizeNote({ date: "2026-11-10", text: "x", updatedAt: "вчера" })?.updatedAt, new Date(0).toISOString());
});

test("normalizeNotes: на дату один итог — более новый, свежие дни сверху", () => {
  const got = normalizeNotes([
    note("2026-11-08", "старый", "2026-11-08T20:00:00.000Z"),
    note("2026-11-10", "поздний", "2026-11-10T22:00:00.000Z"),
    note("2026-11-08", "новее", "2026-11-09T08:00:00.000Z"),
    { мусор: true },
  ]);
  eq("порядок и содержание", got.map((n) => `${n.date}:${n.text}`), ["2026-11-10:поздний", "2026-11-08:новее"]);
});

test("normalizeNotes: не массив — пусто, а не падение", () => {
  eq("объект", normalizeNotes({}), []);
  eq("undefined", normalizeNotes(undefined), []);
  eq("строка", normalizeNotes("[]"), []);
});

test("mergeNotes: из копии добавляется недостающее, на общей дате побеждает свежая правка", () => {
  const local = [note("2026-11-10", "здесь новее", "2026-11-10T22:00:00.000Z"), note("2026-11-05", "только здесь")];
  const incoming = [
    note("2026-11-10", "в копии старее", "2026-11-10T09:00:00.000Z"),
    note("2026-11-03", "только в копии"),
    note("2026-11-05", "в копии новее", "2026-12-01T00:00:00.000Z"),
  ];
  const got = mergeNotes(local, incoming);
  eq(
    "итог слияния",
    got.map((n) => `${n.date}:${n.text}`),
    ["2026-11-10:здесь новее", "2026-11-05:в копии новее", "2026-11-03:только в копии"],
  );
});

test("mergeNotes: пустая или негодная копия ничего не стирает", () => {
  const local = [note("2026-11-10", "моё")];
  eq("пустая", mergeNotes(local, []), local);
  eq("не массив", mergeNotes(local, null), local);
});

test("previewOf: переносы схлопываются, длинное обрезается с многоточием", () => {
  eq("переносы", previewOf("раз\n\nдва   три"), "раз два три");
  eq("короткое как есть", previewOf("коротко"), "коротко");
  const cut = previewOf("слово ".repeat(60), 50);
  ok("обрезано", cut.length <= 51 && cut.endsWith("…"));
});

test("monthWeeks: ноябрь 2026 начинается в воскресенье и занимает шесть недель", () => {
  const weeks = monthWeeks({ year: 2026, month: 10 });
  eq("шесть недель", weeks.length, 6);
  ok("в каждой семь мест", weeks.every((w) => w.length === 7));
  eq("первая неделя: шесть пустых и воскресенье 1-е", weeks[0], [null, null, null, null, null, null, "2026-11-01"]);
  eq("вторая неделя с понедельника 2-го", weeks[1][0], "2026-11-02");
  eq("30-е — понедельник последней недели", weeks[5], ["2026-11-30", null, null, null, null, null, null]);
});

test("monthWeeks: все дни месяца на месте, по одному разу, подряд", () => {
  for (const [y, m, days] of [[2026, 1, 28], [2028, 1, 29], [2026, 3, 30], [2026, 11, 31], [2026, 0, 31]] as const) {
    const flat = monthWeeks({ year: y, month: m }).flat().filter((d): d is string => d !== null);
    eq(`дней в ${y}-${m + 1}`, flat.length, days);
    ok(`подряд в ${y}-${m + 1}`, flat.every((d, i) => d.endsWith(String(i + 1).padStart(2, "0"))));
    ok(`все настоящие в ${y}-${m + 1}`, flat.every(isDateKey));
  }
});

test("monthWeeks: понедельник — первое число — без пустых впереди", () => {
  // 1 июня 2026 — понедельник.
  eq("первое число в первой клетке", monthWeeks({ year: 2026, month: 5 })[0][0], "2026-06-01");
});

test("shiftMonth: переход через границу года в обе стороны", () => {
  eq("вперёд через год", shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  eq("назад через год", shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  eq("на несколько лет", shiftMonth({ year: 2026, month: 5 }, -30), { year: 2023, month: 11 });
  eq("на месте", shiftMonth({ year: 2026, month: 5 }, 0), { year: 2026, month: 5 });
});

test("monthOf и monthTitle", () => {
  eq("monthOf", monthOf("2026-11-10"), { year: 2026, month: 10 });
  eq("заголовок", monthTitle({ year: 2026, month: 10 }), "Ноябрь 2026");
});
