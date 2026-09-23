/*
 * Звуки «Опушки» — синтезируются здесь, а не скачиваются.
 *
 * Свои звуки, а не чужие: ни лицензий, ни ссылок, которые однажды пропадут, и все звучат
 * одной рукой — мягко, без резких пиков, в тон спокойной игре. Скрипт детерминированный
 * (одно зерно — одни и те же файлы), так что пересборка ничего не меняет, пока не поменяли
 * сам скрипт.
 *
 *   node tools/sounds/make-village-sounds.js
 *
 * Пишет WAV (моно, 22 050 Гц, 16 бит) в assets/sounds/village/.
 */
const fs = require("fs");
const path = require("path");

const RATE = 22050;
const OUT = path.join(__dirname, "..", "..", "assets", "sounds", "village");

// --- основа ---------------------------------------------------------------------------

let seed = 20260923;
const rnd = () => {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;
const buf = (sec) => new Float32Array(Math.round(sec * RATE));
const TAU = Math.PI * 2;

/** Огибающая: быстрая атака, экспоненциальное затухание. */
const env = (t, attack, decay) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** Однополюсный фильтр нижних частот — делает шум мягче. */
function lowpass(x, cutoff) {
  const a = Math.exp((-TAU * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y = (1 - a) * x[i] + a * y;
  return x;
}
function highpass(x, cutoff) {
  const low = lowpass(Float32Array.from(x), cutoff);
  for (let i = 0; i < x.length; i++) x[i] -= low[i];
  return x;
}
const bandpass = (x, lo, hi) => lowpass(highpass(x, lo), hi);

/** Сложить src в dst, начиная с секунды at, с громкостью gain. */
function mix(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * RATE);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
}

/** Нота: синус с парой обертонов и своей огибающей. */
function tone(freq, sec, { attack = 0.004, decay = 0.15, harmonics = [1, 0.3, 0.1], glide = 0 } = {}) {
  const x = buf(sec);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const f = freq * (1 + glide * t);
    phase += (TAU * f) / RATE;
    let v = 0;
    harmonics.forEach((h, k) => (v += h * Math.sin(phase * (k + 1))));
    x[i] = v * env(t, attack, decay);
  }
  return x;
}

/** Шумовой щелчок/шорох с огибающей. */
function burst(sec, { attack = 0.002, decay = 0.03, lo = 200, hi = 4000 } = {}) {
  const x = buf(sec);
  for (let i = 0; i < x.length; i++) x[i] = noise() * env(i / RATE, attack, decay);
  return bandpass(x, lo, hi);
}

/** Довести пик до уровня и сгладить края, чтобы не щёлкало. */
function finish(x, peak = 0.7) {
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 1;
  const fade = Math.min(x.length / 4, Math.round(0.004 * RATE));
  for (let i = 0; i < x.length; i++) {
    x[i] *= g;
    if (i < fade) x[i] *= i / fade;
    if (i >= x.length - fade) x[i] *= (x.length - 1 - i) / fade;
  }
  return x;
}

function writeWav(name, x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(OUT, `${name}.wav`), Buffer.concat([head, data]));
  return data.length + 44;
}

// --- звуки ----------------------------------------------------------------------------

const S = {};

// Шаг по траве: мягкий шорох. Два варианта — одинаковые шаги подряд звучат как метроном.
S.step1 = finish(burst(0.09, { attack: 0.006, decay: 0.028, lo: 300, hi: 2200 }), 0.35);
S.step2 = finish(burst(0.09, { attack: 0.008, decay: 0.024, lo: 400, hi: 2800 }), 0.32);

// Ветки: сухой треск — два коротких щелчка и хруст.
S.twig = finish(
  mix(mix(burst(0.16, { decay: 0.012, lo: 1200, hi: 6000 }), burst(0.08, { decay: 0.01, lo: 1500, hi: 7000 }), 0.045, 0.8), burst(0.1, { decay: 0.03, lo: 600, hi: 3000 }), 0.07, 0.4),
  0.6,
);

// Камешки: два звонких клика.
S.pebble = finish(
  mix(
    mix(buf(0.2), tone(2300, 0.08, { decay: 0.018, harmonics: [1, 0.5, 0.2] })),
    mix(tone(1900, 0.08, { decay: 0.02, harmonics: [1, 0.4] }), burst(0.03, { decay: 0.006, lo: 2000, hi: 8000 }), 0, 0.4),
    0.075,
    0.8,
  ),
  0.55,
);

// Топор: глухой удар по дереву — низкий «тук» и щепки.
S.chop = finish(
  mix(
    mix(tone(170, 0.35, { attack: 0.002, decay: 0.07, harmonics: [1, 0.6, 0.35, 0.15], glide: -0.6 }), burst(0.06, { decay: 0.012, lo: 800, hi: 5000 }), 0, 0.7),
    burst(0.2, { attack: 0.01, decay: 0.05, lo: 1500, hi: 6000 }),
    0.05,
    0.25,
  ),
  0.8,
);

// Валун: раскол — хруст пониже и россыпь.
S.stone = (() => {
  const x = mix(buf(0.5), burst(0.25, { decay: 0.06, lo: 150, hi: 1800 }));
  mix(x, tone(95, 0.3, { decay: 0.08, harmonics: [1, 0.5] }), 0, 0.8);
  for (let k = 0; k < 5; k++) mix(x, tone(1600 + rnd() * 1400, 0.06, { decay: 0.015 }), 0.08 + k * 0.05 + rnd() * 0.03, 0.35);
  return finish(x, 0.75);
})();

// Ягоды: мягкий щипок — две ноты.
S.berries = finish(mix(tone(660, 0.25, { decay: 0.07, harmonics: [1, 0.2] }), tone(990, 0.25, { decay: 0.08, harmonics: [1, 0.15] }), 0.06, 0.7), 0.5);

// Вода: «плюх» — нота, съезжающая вверх, и немного брызг.
S.water = finish(mix(tone(420, 0.25, { attack: 0.005, decay: 0.06, harmonics: [1], glide: 3 }), burst(0.15, { attack: 0.01, decay: 0.04, lo: 1500, hi: 6000 }), 0.02, 0.3), 0.5);

// Еда: хрум-хрум — три коротких хруста.
S.eat = (() => {
  const x = buf(0.42);
  [0, 0.13, 0.26].forEach((at, k) => mix(x, burst(0.1, { decay: 0.025 - k * 0.003, lo: 700, hi: 4500 }), at, 1 - k * 0.2));
  return finish(x, 0.5);
})();

// Ремесло: три удара молотком по дереву и металлу.
S.craft = (() => {
  const x = buf(0.6);
  [0, 0.16, 0.32].forEach((at, k) => {
    mix(x, tone(1250 + k * 60, 0.15, { decay: 0.035, harmonics: [1, 0.2, 0.5, 0.1] }), at, 0.6);
    mix(x, tone(210, 0.12, { decay: 0.03, harmonics: [1, 0.4] }), at, 0.8);
  });
  return finish(x, 0.65);
})();

// Поставить: низкий мягкий «бум».
S.place = finish(mix(tone(88, 0.35, { attack: 0.004, decay: 0.09, harmonics: [1, 0.5, 0.2], glide: -0.4 }), burst(0.08, { decay: 0.02, lo: 200, hi: 1500 }), 0, 0.5), 0.8);

// Разобрать: шорох, уходящий вверх.
S.pickup = (() => {
  const x = buf(0.28);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    x[i] = noise() * Math.sin((Math.PI * t) / 0.28);
  }
  bandpass(x, 800, 5000);
  return finish(mix(x, tone(520, 0.2, { decay: 0.06, glide: 1.2 }), 0.05, 0.6), 0.45);
})();

// Сон: тихий колокольчик вниз — три ноты.
S.sleep = (() => {
  const x = buf(1.6);
  [880, 659.25, 523.25].forEach((f, k) => mix(x, tone(f, 1.1, { attack: 0.01, decay: 0.35, harmonics: [1, 0.25, 0.08] }), k * 0.28, 0.7));
  return finish(x, 0.55);
})();

// Задача выполнена: светлое арпеджио вверх.
S.goal = (() => {
  const x = buf(1.3);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => mix(x, tone(f, 0.8, { attack: 0.006, decay: 0.22, harmonics: [1, 0.3, 0.1] }), k * 0.1, 0.7));
  return finish(x, 0.6);
})();

// Нельзя: низкий мягкий «бум-бум» вниз.
S.nope = finish(mix(tone(240, 0.14, { decay: 0.04, harmonics: [1, 0.3] }), tone(180, 0.18, { decay: 0.05, harmonics: [1, 0.3] }), 0.08, 0.9), 0.45);

// Кнопка: едва слышный щелчок.
S.ui = finish(mix(tone(1500, 0.04, { attack: 0.001, decay: 0.008 }), burst(0.02, { decay: 0.004, lo: 2000, hi: 8000 }), 0, 0.3), 0.3);

// Сумка: шорох ткани.
S.bag = finish(burst(0.22, { attack: 0.03, decay: 0.07, lo: 500, hi: 3500 }), 0.4);

// --- фон ------------------------------------------------------------------------------

/** Петля без шва: хвост плавно накладывается на начало. */
function loop(x, xfadeSec) {
  const n = Math.round(xfadeSec * RATE);
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * k + x[x.length - n + i] * (1 - k);
  }
  return out;
}

/** Ветер: коричневый шум, едва колышущийся по громкости. */
function wind(sec, level) {
  const x = buf(sec);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = 0.985 * y + noise() * 0.02;
    const t = i / RATE;
    x[i] = y * (0.7 + 0.3 * Math.sin((TAU * t) / 5.3)) * level;
  }
  return lowpass(x, 700);
}

/** Птица: пара быстрых посвистов с трелью. */
function bird(base) {
  const x = buf(0.5);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const note = Math.floor(t / 0.12);
    const local = t - note * 0.12;
    const f = base * (1 + 0.35 * Math.sin((Math.PI * local) / 0.12)) * (note % 2 ? 1.15 : 1);
    phase += (TAU * f) / RATE;
    const e = local < 0.09 ? Math.sin((Math.PI * local) / 0.09) : 0;
    x[i] = Math.sin(phase) * e * (note < 3 ? 1 : 0) * (1 + 0.3 * Math.sin(TAU * 38 * t));
  }
  return x;
}

S.amb_day = (() => {
  const sec = 12.5;
  const x = wind(sec, 1);
  const w = finish(Float32Array.from(x), 0.18);
  const birds = buf(sec);
  [
    [1.2, 3100],
    [3.9, 2600],
    [4.4, 2750],
    [7.1, 3400],
    [9.6, 2900],
  ].forEach(([at, f]) => mix(birds, bird(f), at, 0.18));
  return loop(mix(w, birds), 0.5);
})();

S.amb_night = (() => {
  const sec = 12.5;
  const w = finish(wind(sec, 1), 0.1);
  const crickets = buf(sec);
  // Сверчки: пачки коротких стрекотаний, у каждого свой ритм.
  [
    [4300, 0.9, 0.0],
    [4700, 1.35, 0.4],
  ].forEach(([f, every, offset]) => {
    for (let at = offset; at < sec - 0.3; at += every) {
      for (let k = 0; k < 3; k++) mix(crickets, tone(f, 0.03, { attack: 0.003, decay: 0.008, harmonics: [1] }), at + k * 0.045, 0.1);
    }
  });
  return loop(mix(w, crickets), 0.5);
})();

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, x] of Object.entries(S)) total += writeWav(name, x);
console.log(`${Object.keys(S).length} звуков, ${Math.round(total / 1024)} КБ → ${OUT}`);
