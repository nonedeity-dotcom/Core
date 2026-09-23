import { eq, ok, test } from "./harness";
import {
  ICON_ITEMS,
  SHOP_ITEMS,
  THEME_PACKS,
  TITLE_RULES,
  earnedTitles,
  itemById,
  nextTitle,
  purchaseTitle,
  shopStanding,
  type TitleState,
} from "../src/lib/rewards/catalog";
import { ICON_PACKS, isKnownIcon, openIcons, packOpen } from "../src/lib/rewards/icons";
import { WORD_THEMES, themeItemId, themeOpen } from "../src/content/wordThemes";
import { earnedAwards, SPARKS, type EarnState } from "../src/lib/rewards/earn";

const empty: TitleState = {
  bestStreak: 0, closedDays: 0, summaries: 0, goalsDone: 0, fields: 0, hardFields: 0, wheelLevels: 0,
  mealDays: 0, weights: 0, screenDays: 0, focusMinutes: 0,
};

test("титулы", () => {
  eq("на пустом месте нет", earnedTitles(empty).length, 0);
  eq("всего тринадцать", TITLE_RULES.length, 13);
  eq("порог — даётся", earnedTitles({ ...empty, weights: 30 }).map((t) => t.id), ["t-weighed"]);
  eq("порог минус один — нет", earnedTitles({ ...empty, weights: 29 }).length, 0);
  eq("ближайший — по долям, а не штукам", nextTitle({ ...empty, weights: 29, closedDays: 1 })?.rule.id, "t-weighed");
  eq("всё взято — ближайшего нет", nextTitle({
    bestStreak: 999, closedDays: 999, summaries: 9, goalsDone: 9, fields: 99, hardFields: 99, wheelLevels: 99,
    mealDays: 99, weights: 99, screenDays: 99, focusMinutes: 9999,
  }), null);
});

test("магазин", () => {
  const paid = SHOP_ITEMS.filter((i) => i.cores > 0).length;
  eq("бесплатное не в счёт", shopStanding([], 0), { have: 0, total: paid, affordable: 0 });
  eq("купленное в счёт", shopStanding(["theme-space"], 0).have, 1);
  ok("на гору ядер хватает на всё", shopStanding([], 9999).affordable === paid);
  eq("покупка названа с видом", purchaseTitle(itemById("theme-space")!), "Тема «Космос»");
  eq("идентификаторы не повторяются", new Set(SHOP_ITEMS.map((i) => i.id)).size, SHOP_ITEMS.length);
});

test("темы", () => {
  eq("платных пять", THEME_PACKS.length, 5);
  ok("у каждой платной есть товар", WORD_THEMES.filter((t) => t.paid).every((t) => THEME_PACKS.some((i) => i.id === themeItemId(t.id))));
  ok("в каждой полсотни слов", WORD_THEMES.every((t) => t.words.length === 50));
  ok("слова без Ё и от трёх до девяти букв", WORD_THEMES.every((t) => t.words.every((w) => !w.includes("Ё") && w.length >= 3 && w.length <= 9)));
  ok("внутри темы без повторов", WORD_THEMES.every((t) => new Set(t.words).size === t.words.length));
  eq("бесплатная открыта", themeOpen(WORD_THEMES[0], []), true);
  const paidTheme = WORD_THEMES.find((t) => t.paid)!;
  eq("платная заперта", themeOpen(paidTheme, []), false);
  eq("купленная открыта", themeOpen(paidTheme, [themeItemId(paidTheme.id)]), true);
});

test("значки", () => {
  eq("бесплатный набор один", ICON_PACKS.filter((p) => p.cores === 0).length, 1);
  eq("платные наборы — в магазине", ICON_ITEMS.length, ICON_PACKS.filter((p) => p.cores > 0).length);
  eq("без покупок — только базовые шесть", openIcons([]).length, 6);
  eq("купленный набор добавляет свои", openIcons(["icons-body"]).length, 12);
  eq("платный заперт", packOpen(ICON_PACKS[1], []), false);
  eq("чужой значок не узнаётся", isKnownIcon("rocket"), false);
  ok("значки не повторяются между наборами", new Set(ICON_PACKS.flatMap((p) => p.icons)).size === ICON_PACKS.length * 6);
});

test("начисление из CaloriX и Creker", () => {
  const state: EarnState = {
    countedDates: [], today: "2026-09-22", bestStreak: 0, sessionsByDate: {},
    summaries: [], goalsDone: [], fields: { easy: 0, normal: 0, hard: 0 }, records: [],
    mealDates: ["2026-09-20", "2026-09-22"], weightDates: ["2026-09-21"], screenDates: ["2026-09-21", "2026-09-22"],
    wheelLevels: 0, wheelBonus: 0,
  };
  const keys = earnedAwards(state).map((a) => a.key);
  ok("вчерашняя еда оплачена", keys.includes("meal:2026-09-20"));
  ok("сегодняшняя — ещё нет", !keys.includes("meal:2026-09-22"));
  ok("вчерашний экран оплачен", keys.includes("screen:2026-09-21"));
  ok("сегодняшний — ещё нет", !keys.includes("screen:2026-09-22"));
  eq("сумма", earnedAwards(state).reduce((n, a) => n + a.sparks, 0), SPARKS.meal + SPARKS.weight + SPARKS.screen);
});

test("колесо: уровни и бонусные слова", () => {
  const base: EarnState = {
    countedDates: [], today: "2026-09-22", bestStreak: 0, sessionsByDate: {},
    summaries: [], goalsDone: [], fields: { easy: 0, normal: 0, hard: 0 }, records: [],
    mealDates: [], weightDates: [], screenDates: [], wheelLevels: 3, wheelBonus: 27,
  };
  const keys = earnedAwards(base).map((a) => a.key);
  eq("по ключу на уровень", keys.filter((k) => k.startsWith("wheel:")), ["wheel:1", "wheel:2", "wheel:3"]);
  eq("бонус — за каждый полный десяток", keys.filter((k) => k.startsWith("wheel-bonus:")), ["wheel-bonus:10", "wheel-bonus:20"]);
  eq("«Словесник» за пятьдесят уровней", earnedTitles({ ...empty, wheelLevels: 50 }).map((t) => t.id), ["t-wordsmith"]);
});
