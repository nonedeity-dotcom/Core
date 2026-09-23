import { eq, ok, test } from "./harness";
import {
  EMPTY_PURSE,
  HISTORY_LIMIT,
  MELT,
  applyAwards,
  buy,
  equip,
  melt,
  meltWaitDays,
  mergePurse,
  normalizePurse,
  spend,
  type Purse,
} from "../src/lib/rewards/currency";
import { mergeGameStats, normalizeGameStats } from "../src/lib/games/stats";

const T = "2026-09-23";
const rich: Purse = { ...EMPTY_PURSE, wallet: { sparks: 500, cores: 40 } };

test("начисление платит один раз", () => {
  const award = { key: "day:1", title: "День", sparks: 10, cores: 0 };
  const once = applyAwards(EMPTY_PURSE, [award], T);
  eq("пришло", once.wallet, { sparks: 10, cores: 0 });
  eq("второй раз не платят", applyAwards(once, [award], T).wallet, { sparks: 10, cores: 0 });
});

test("трата видна в журнале со знаком", () => {
  const p = spend(rich, { sparks: 80 }, "Подсказка: слово", T)!;
  eq("списалось", p.wallet.sparks, 420);
  eq("минус в журнале", p.history[0].sparks, -80);
  eq("не хватило — ничего не записано", spend(EMPTY_PURSE, { sparks: 1 }, "x", T), null);
  eq("две траты — две строки", spend(p, { sparks: 30 }, "Подсказка: буква", T)!.history.length, 2);
});

test("покупка", () => {
  const p = buy(rich, "theme-space", { cores: 10 }, "Тема «Космос»", T)!;
  eq("ядра списались", p.wallet.cores, 30);
  ok("вещь своя", p.owned.includes("theme-space"));
  eq("дважды не купишь", buy(p, "theme-space", { cores: 10 }, "x", T), null);
  eq("без денег не купишь", buy(EMPTY_PURSE, "theme-space", { cores: 10 }, "x", T), null);
});

test("переплавка раз в неделю", () => {
  const once = melt(rich, T)!;
  eq("искры → ядро", once.wallet, { sparks: 500 - MELT.sparks, cores: 41 });
  eq("обе стороны в одной строке", [once.history[0].sparks, once.history[0].cores], [-MELT.sparks, MELT.cores]);
  eq("второй раз в тот же день нельзя", melt(once, T), null);
  eq("через шесть дней ещё рано", meltWaitDays(once, "2026-09-29"), 1);
  eq("через семь можно", meltWaitDays(once, "2026-09-30"), 0);
  eq("без двухсот искр нельзя", melt({ ...EMPTY_PURSE, wallet: { sparks: 199, cores: 0 } }, T), null);
});

test("надеть не трогает остальное", () => {
  const p = equip(rich, "palette", "palette-moss");
  eq("надето", p.equipped.palette, "palette-moss");
  eq("кошелёк тот же", p.wallet, rich.wallet);
});

test("чтение из хранилища", () => {
  const old = normalizePurse({ wallet: { sparks: 5, cores: 1 }, paid: ["a", "a"], history: [] });
  eq("повторы ключей схлопнуты", old.paid, ["a"]);
  eq("журнала дней нет — пустой", old.ledger.through, "");
  eq("минус в журнале переживает чтение",
    normalizePurse({ history: [{ key: "k", title: "t", sparks: -80, cores: 0, at: T }] }).history[0].sparks, -80);
  eq("журнал подрезается",
    normalizePurse({ history: Array.from({ length: 200 }, (_, i) => ({ key: `k${i}`, title: "t", sparks: 1, cores: 0, at: T })) }).history.length,
    HISTORY_LIMIT);
  eq("мусор — пустой кошелёк", normalizePurse("мусор").wallet, { sparks: 0, cores: 0 });
  eq("битые даты в журнале дней отброшены",
    normalizePurse({ ledger: { through: "вчера", closed: ["2026-09-01", 7, "x"] } }).ledger, { through: "", closed: ["2026-09-01"], rest: [], screen: [] });
});

test("слияние кошельков при переносе", () => {
  const phone = { ...rich, owned: ["palette-ember"], paid: ["day:1"] };
  const fromFile = { ...EMPTY_PURSE, wallet: { sparks: 900, cores: 90 }, owned: ["theme-space"], paid: ["day:1", "day:2"] };
  eq("пустой телефон берёт пришедший целиком", mergePurse(EMPTY_PURSE, fromFile), fromFile);
  const merged = mergePurse(phone, fromFile);
  eq("деньги не складываются", merged.wallet, phone.wallet);
  eq("купленное с обоих телефонов", merged.owned, ["palette-ember", "theme-space"]);
  eq("оплаченное своё", merged.paid, ["day:1"]);
});

test("слияние игр при переносе", () => {
  const a = normalizeGameStats({ wordsearch: { solved: 10, byDifficulty: { easy: 6, normal: 4 }, best: { "food:easy": 90 } } });
  const b = normalizeGameStats({ wordsearch: { solved: 7, byDifficulty: { hard: 2 }, best: { "food:easy": 70, "home:hard": 300 } } });
  const m = mergeGameStats(a, b);
  eq("поля не складываются — большее", m.wordsearch.solved, 10);
  eq("по сложностям — большее", m.wordsearch.byDifficulty, { easy: 6, normal: 4, hard: 2 });
  eq("рекорд — лучший", m.wordsearch.best, { "food:easy": 70, "home:hard": 300 });
});
