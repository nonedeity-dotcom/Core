import { eq, ok, test } from "./harness";
import { WEEKS, daysSince, yearGrid } from "../src/lib/path/year";
import { dayOfWeek } from "../src/lib/week";
import { DEFAULT_DAY_OFF } from "../src/lib/dayOff";

const today = "2026-09-22"; // вторник
const base = { today, frozen: new Set<string>(), daysOff: DEFAULT_DAY_OFF, since: "2026-01-10" };
const g = yearGrid({ ...base, closed: new Set(["2026-09-21", "2026-09-20", "2026-01-10"]) });
const at = (grid: typeof g, date: string) => grid.weeks.flat().find((d) => d.date === date)?.mark;

test("форма решётки", () => {
  eq("колонок — недель", g.weeks.length, WEEKS);
  eq("строки — дни недели с понедельника", g.weeks[0].map((d) => dayOfWeek(d.date)), [1, 2, 3, 4, 5, 6, 7]);
  ok("сегодня в правой колонке", g.weeks[g.weeks.length - 1].some((d) => d.date === today));
  eq("счётчики покрывают всё", Object.values(g.counts).reduce((a, b) => a + b, 0), WEEKS * 7);
});

test("что чем помечено", () => {
  eq("сегодня", at(g, today), "today");
  eq("завтра", at(g, "2026-09-23"), "future");
  eq("вчера закрыто", at(g, "2026-09-21"), "closed");
  eq("воскресенье — в прошлой колонке и закрыто", at(g, "2026-09-20"), "closed");
  eq("до начала пути — пусто, а не промах", at(g, "2026-01-09"), "before");
  const g2 = yearGrid({ ...base, closed: new Set(), frozen: new Set(["2026-09-15"]), daysOff: { weekdays: [7], dates: ["2026-09-14"] } });
  eq("заморозка", at(g2, "2026-09-15"), "frozen");
  eq("разовый выходной", at(g2, "2026-09-14"), "off");
  eq("постоянный выходной", at(g2, "2026-09-13"), "off");
  eq("обычный пропуск", at(g2, "2026-09-16"), "missed");
});

test("подписи месяцев", () => {
  ok("по возрастанию", g.months.every((m, i) => i === 0 || m.column > g.months[i - 1].column));
  ok("не у самого края", g.months.every((m) => m.column <= WEEKS - 3));
  // Раньше месяц узнавался по понедельнику, и почти все подписи терялись.
  ok("около двенадцати", g.months.length >= 10 && g.months.length <= 13);
});

test("сколько дней в пути", () => {
  eq("считая первый", daysSince("2026-09-20", today), 3);
  eq("без начала — ноль", daysSince(null, today), 0);
});
