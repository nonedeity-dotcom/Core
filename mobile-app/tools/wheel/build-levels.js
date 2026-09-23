/*
 * Собирает уровни «Колеса букв» в src/content/wheelLevels.json.
 *
 * Запускается руками и редко — когда нужно пересобрать уровни. В приложение едет только
 * готовый файл: полный словарь внутри телефона не нужен, уровню хватает своих слов.
 *
 * Откуда слова (оба источника открытые, в репозиторий не кладутся — скачиваются рядом):
 *   1. dictionary-ru (npm), BSD-3-Clause, © Alexander I. Lebedev — начальные формы слов.
 *        npm pack dictionary-ru@3.0.0 && tar xzf dictionary-ru-3.0.0.tgz
 *   2. FrequencyWords, ru_50k.txt, © Hermit Dave, MIT — частота по субтитрам.
 *        https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt
 *
 *   node tools/wheel/build-levels.js <путь к index.dic> <путь к ru_50k.txt>
 *
 * Словарь даёт «настоящее ли это слово», частота — «знает ли его обычный человек». Одного
 * словаря мало: в нём сто сорок шесть тысяч слов, и уровень, собранный из «чрева» и «вежи»,
 * раздражает, а не развлекает.
 */
const fs = require("fs");
const path = require("path");

const [dicPath, freqPath] = process.argv.slice(2);
if (!dicPath || !freqPath) {
  console.error("node tools/wheel/build-levels.js <index.dic> <ru_50k.txt>");
  process.exit(1);
}

// --- слова -------------------------------------------------------------------

/** Флаги словаря, которые сверкой с 550 существительными из тем оказались существительными. */
const NOUN_FLAGS = new Set(["K", "I", "J", "N", "G", "F"]);

/**
 * Корни, которых в игре не будет ни в сетке, ни бонусом.
 *
 * Частотный список собран по субтитрам, и грубость в нём стоит высоко. Играть в неё на
 * перерыве не хочется, а бонус за найденное ругательство — тем более.
 */
const RUDE = [
  "хуй", "хуе", "хуи", "хуя", "пизд", "ебат", "ебан", "ебал", "ебл", "еба", "ебу", "бля", "муда", "мудо", "мудил",
  "пидор", "пидар", "гандон", "шлюх", "сука", "суки", "сучк", "сучар", "залуп", "дерьм", "говн", "жоп", "срак", "сран",
  "ссан", "трах", "манд", "дроч", "херн", "хрен", "задниц", "член", "секс", "порн", "шалав", "курв", "педик", "чмо", "урод",
  // Оскорбления людей по происхождению и здоровью: в словаре они есть, в игре им не место.
  "негр", "жид", "хохол", "хохл", "хач", "чурк", "чучмек", "москал", "узкоглаз", "даун", "дебил", "кретин", "дегенерат",
  "идиот", "имбецил", "олигофрен", "калек", "гомик", "лесби", "шлюш", "проститу", "насил", "убий", "труп", "смерт",
];
const rude = (w) => RUDE.some((r) => w.includes(r));

/**
 * Омонимы, у которых частое значение — не существительное.
 *
 * «Под» в словаре есть как существительное (под печи), а высоко в частоте стоит потому, что
 * это предлог. В сетке такое слово выглядит ошибкой, даже когда формально оно верное.
 */
const NOT_REALLY_NOUNS = new Set([
  "под", "над", "мол", "весь", "чем", "при", "лишь", "уже", "кто", "что", "где", "как", "так", "вот", "тем",
  "том", "мир", "раз", "дам", "дал", "ели", "сел", "мой", "вой", "бой", "мак", "рад", "рада", "пас",
]);

const clean = (w) => w.toLowerCase().replace(/ё/g, "е");
const LETTERS = /^[а-я]+$/;

const freq = fs.readFileSync(freqPath, "utf8").split("\n").map((l) => l.split(" ")[0]).filter(Boolean);
const rank = new Map();
freq.forEach((w, i) => {
  const k = clean(w);
  if (!rank.has(k)) rank.set(k, i);
});

const nouns = new Map(); // слово → частотный ранг
const valid = new Set(); // всё, что засчитывается бонусом
for (const line of fs.readFileSync(dicPath, "utf8").split("\n").slice(1)) {
  const [raw, flags = ""] = line.trim().split("/");
  if (!raw || raw !== raw.toLowerCase()) continue; // имена собственные и аббревиатуры
  const w = clean(raw);
  if (!LETTERS.test(w) || w.length < 3 || w.length > 7 || rude(w)) continue;
  const r = rank.get(w);
  // Бонусом засчитывается всякое настоящее слово, которое хоть кто-то употребляет.
  if (flags && r !== undefined && r < 50000) valid.add(w);
  // В сетку — только ходовые существительные.
  if (NOUN_FLAGS.has(flags) && r !== undefined && r < 30000 && !NOT_REALLY_NOUNS.has(w) && !nouns.has(w)) {
    nouns.set(w, r);
  }
}
for (const w of nouns.keys()) valid.add(w);

// --- буквы -------------------------------------------------------------------

const countOf = (w) => {
  const m = new Map();
  for (const ch of w) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
};
const fits = (word, pool) => {
  const need = countOf(word);
  for (const [ch, n] of need) if ((pool.get(ch) ?? 0) < n) return false;
  return true;
};

// --- случайность с зерном: уровни должны собираться одинаково при каждом запуске ------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (a, rnd) => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// --- кроссворд -----------------------------------------------------------------

/** Сторона сетки. Восемь клеток — предел, при котором буква на телефоне ещё читается. */
const MAX_SIDE = 8;

/**
 * Разложить слова крестом: каждое следующее пересекает уже лежащее по общей букве.
 *
 * Правила обычного кроссворда: пересечение — только по совпадающей букве; параллельные
 * слова не соприкасаются боками; перед началом и после конца слова пусто. Из нескольких
 * попыток с разным порядком берётся та, где слов больше, а при равенстве — компактнее.
 */
function layout(words, rnd, tries = 40) {
  let best = null;
  for (let t = 0; t < tries; t++) {
    const order = t === 0 ? words : [words[0], ...shuffle(words.slice(1), rnd)];
    const cells = new Map();
    const placed = [];
    const put = (w, r, c, dir) => {
      for (let i = 0; i < w.length; i++) {
        const [rr, cc] = dir === "h" ? [r, c + i] : [r + i, c];
        cells.set(`${rr},${cc}`, w[i]);
      }
      placed.push({ w, r, c, dir });
    };
    const at = (r, c) => cells.get(`${r},${c}`);
    const bounds = () => {
      let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (const k of cells.keys()) {
        const [r, c] = k.split(",").map(Number);
        r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      }
      return { r0, r1, c0, c1 };
    };
    const fitsGrid = (w, r, c, dir) => {
      const before = dir === "h" ? at(r, c - 1) : at(r - 1, c);
      const after = dir === "h" ? at(r, c + w.length) : at(r + w.length, c);
      if (before !== undefined || after !== undefined) return -1;
      let crossings = 0;
      for (let i = 0; i < w.length; i++) {
        const [rr, cc] = dir === "h" ? [r, c + i] : [r + i, c];
        const here = at(rr, cc);
        if (here !== undefined) {
          if (here !== w[i]) return -1;
          crossings++;
          continue;
        }
        const side1 = dir === "h" ? at(rr - 1, cc) : at(rr, cc - 1);
        const side2 = dir === "h" ? at(rr + 1, cc) : at(rr, cc + 1);
        if (side1 !== undefined || side2 !== undefined) return -1;
      }
      if (crossings === 0) return -1;
      // Не вылезти за сторону сетки.
      const b = bounds();
      const endR = dir === "h" ? r : r + w.length - 1;
      const endC = dir === "h" ? c + w.length - 1 : c;
      const r0 = Math.min(b.r0, r), r1 = Math.max(b.r1, endR), c0 = Math.min(b.c0, c), c1 = Math.max(b.c1, endC);
      if (r1 - r0 + 1 > MAX_SIDE || c1 - c0 + 1 > MAX_SIDE) return -1;
      return crossings;
    };

    put(order[0], 0, 0, "h");
    for (const w of order.slice(1)) {
      let choice = null;
      for (const p of placed) {
        for (let i = 0; i < p.w.length; i++) {
          for (let j = 0; j < w.length; j++) {
            if (p.w[i] !== w[j]) continue;
            const dir = p.dir === "h" ? "v" : "h";
            const [pr, pc] = p.dir === "h" ? [p.r, p.c + i] : [p.r + i, p.c];
            const [r, c] = dir === "h" ? [pr, pc - j] : [pr - j, pc];
            const score = fitsGrid(w, r, c, dir);
            if (score > 0 && (!choice || score > choice.score || (score === choice.score && rnd() < 0.3))) {
              choice = { r, c, dir, score };
            }
          }
        }
      }
      if (choice) put(w, choice.r, choice.c, choice.dir);
    }

    const b = bounds();
    const area = (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
    if (!best || placed.length > best.placed.length || (placed.length === best.placed.length && area < best.area)) {
      best = { placed: placed.map((p) => ({ ...p, r: p.r - b.r0, c: p.c - b.c0 })), area, rows: b.r1 - b.r0 + 1, cols: b.c1 - b.c0 + 1 };
    }
  }
  return best;
}

// --- уровни --------------------------------------------------------------------

/**
 * Ступени сложности: сколько букв в колесе и сколько слов в сетке.
 *
 * Первые уровни короткие намеренно: игра объясняет себя сама, и пять букв с тремя словами
 * — это урок, а не испытание. Дальше растёт и колесо, и сетка.
 */
const TIERS = [
  { count: 30, letters: 5, min: 3, max: 4 },
  { count: 70, letters: 6, min: 4, max: 6 },
  { count: 200, letters: 7, min: 5, max: 8 },
];

const nounList = [...nouns.entries()].sort((a, b) => a[1] - b[1]).map(([w]) => w);
const rnd = rng(20260923);
const usedSets = new Set();
const levels = [];

for (const tier of TIERS) {
  // Основа уровня — существительное на все буквы колеса; чем оно известнее, тем раньше.
  const bases = nounList.filter((w) => w.length === tier.letters);
  const made = [];
  for (const base of bases) {
    if (made.length >= tier.count) break;
    const signature = [...base].sort().join("");
    if (usedSets.has(signature)) continue;
    const pool = countOf(base);
    const grid = nounList.filter((w) => w !== base && w.length >= 3 && fits(w, pool));
    if (grid.length < tier.min - 1) continue;

    const candidates = [base, ...grid.slice(0, tier.max + 3)];
    const lay = layout(candidates.sort((a, b) => b.length - a.length || nouns.get(a) - nouns.get(b)), rnd);
    if (!lay || lay.placed.length < tier.min || !lay.placed.some((p) => p.w === base)) continue;

    // Сверх нормы уровня — в бонус: сетка из двенадцати слов утомляет раньше, чем кончается.
    const keep = lay.placed
      .sort((a, b) => (a.w === base ? -1 : b.w === base ? 1 : nouns.get(a.w) - nouns.get(b.w)))
      .slice(0, tier.max);
    const kept = new Set(keep.map((p) => p.w));
    if (kept.size !== keep.length) continue;
    // Выкинутые из сетки слова могли быть мостом между другими — проверяем, что сетка
    // по-прежнему связна и не распалась на куски.
    const relaid = layout([base, ...keep.filter((p) => p.w !== base).map((p) => p.w)], rng(base.length * 7919), 60);
    if (!relaid || relaid.placed.length !== keep.length) continue;

    const bonus = [...valid].filter((w) => !kept.has(w) && fits(w, pool)).sort();
    usedSets.add(signature);
    made.push({
      letters: shuffle([...base.toUpperCase()], rnd).join(""),
      rows: relaid.rows,
      cols: relaid.cols,
      words: relaid.placed.map((p) => [p.w.toUpperCase(), p.r, p.c, p.dir]),
      bonus: bonus.map((w) => w.toUpperCase()),
    });
  }
  // Внутри ступени — от меньшего числа слов к большему: сложность растёт плавно.
  made.sort((a, b) => a.words.length - b.words.length);
  levels.push(...made);
  console.log(`${tier.letters} букв: ${made.length} уровней`);
}

const out = path.join(__dirname, "../../src/content/wheelLevels.json");
fs.writeFileSync(out, JSON.stringify(levels));
console.log(`всего ${levels.length} уровней, ${(fs.statSync(out).size / 1024).toFixed(0)} КБ → ${out}`);
