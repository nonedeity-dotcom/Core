/**
 * Напоминания, которые приходят, когда есть что сказать.
 *
 * Обычное напоминание приходит в назначенный час независимо ни от чего: «загляни в
 * чек-лист» в девять вечера получит и тот, кто закрыл все привычки в обед. Через неделю
 * такие смахивают не читая, и вместе с ними смахивают те, что были по делу.
 *
 * Здесь другое: правило смотрит на сегодняшний день и молчит, если повода нет. «Осталось
 * две привычки», «за сегодня ни одной записи», «до лимита сорок минут» — это поводы. «Загляни
 * в приложение» — нет.
 *
 * Модуль ничего не знает ни про хранилище, ни про уведомления: на входе состояние дня и
 * настройки, на выходе список того, что стоит прислать. Поэтому его можно гонять в node и
 * проверять на числах, а не на телефоне.
 */

/** Что известно про сегодняшний день на момент проверки. */
export interface DayState {
  /** Привычки, которые решают день: сколько закрыто и сколько всего. */
  habitsDone: number;
  habitsTotal: number;
  /** Сколько записей в дневнике еды за сегодня. */
  meals: number;
  /** Выпито и норма, мл. Ноль в норме — профиль не заполнен, правило молчит. */
  waterMl: number;
  waterTargetMl: number;
  /** Экранное время за сегодня и дневной лимит, миллисекунды. */
  screenMs: number;
  screenLimitMs: number;
  /** Есть ли у приложения доступ к статистике: без него про экран сказать нечего. */
  screenKnown: boolean;
}

export interface TimeRule {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface WaterRule {
  enabled: boolean;
  /** Как часто напоминать, пока норма не набрана. */
  everyHours: number;
  /** С какого и по какой час: ночью человек спит, а не пьёт. */
  fromHour: number;
  toHour: number;
}

export interface ScreenRule {
  enabled: boolean;
  /** За сколько минут до лимита предупредить. */
  minutesBefore: number;
}

export interface SmartRules {
  /** Sterzhen: вечером, если день ещё не закрыт. */
  habitsUndone: TimeRule;
  /** CaloriX: если к этому часу в дневнике пусто. */
  diaryEmpty: TimeRule;
  /** CaloriX: вода, пока норма не набрана. */
  water: WaterRule;
  /** Creker: за сколько до лимита предупредить. */
  screenSoon: ScreenRule;
  /** Creker: сказать в момент, когда лимит перейдён. */
  screenOver: { enabled: boolean };
}

export const DEFAULT_RULES: SmartRules = {
  habitsUndone: { enabled: false, hour: 20, minute: 0 },
  diaryEmpty: { enabled: false, hour: 20, minute: 0 },
  water: { enabled: false, everyHours: 3, fromHour: 10, toHour: 21 },
  screenSoon: { enabled: false, minutesBefore: 60 },
  screenOver: { enabled: false },
};

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

function normalizeTime(raw: unknown, fallback: TimeRule): TimeRule {
  if (typeof raw !== "object" || raw === null) return { ...fallback };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    hour: clampInt(o.hour, 0, 23, fallback.hour),
    minute: clampInt(o.minute, 0, 59, fallback.minute),
  };
}

export function normalizeRules(raw: unknown): SmartRules {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_RULES };
  const o = raw as Record<string, unknown>;
  const w = (typeof o.water === "object" && o.water !== null ? o.water : {}) as Record<string, unknown>;
  const s = (typeof o.screenSoon === "object" && o.screenSoon !== null ? o.screenSoon : {}) as Record<
    string,
    unknown
  >;
  const over = (typeof o.screenOver === "object" && o.screenOver !== null ? o.screenOver : {}) as Record<
    string,
    unknown
  >;
  return {
    habitsUndone: normalizeTime(o.habitsUndone, DEFAULT_RULES.habitsUndone),
    diaryEmpty: normalizeTime(o.diaryEmpty, DEFAULT_RULES.diaryEmpty),
    water: {
      enabled: w.enabled === true,
      everyHours: clampInt(w.everyHours, 1, 12, DEFAULT_RULES.water.everyHours),
      fromHour: clampInt(w.fromHour, 0, 23, DEFAULT_RULES.water.fromHour),
      toHour: clampInt(w.toHour, 0, 23, DEFAULT_RULES.water.toHour),
    },
    screenSoon: {
      enabled: s.enabled === true,
      minutesBefore: clampInt(s.minutesBefore, 5, 240, DEFAULT_RULES.screenSoon.minutesBefore),
    },
    screenOver: { enabled: over.enabled === true },
  };
}

/** Одно готовое уведомление: что прислать и под каким ключом это уже присылали. */
export interface Alert {
  /** Ключ на сегодня. Уже присланное вторым разом не приходит. */
  key: string;
  title: string;
  body: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Минуты от полуночи — в них удобно сравнивать «уже наступило ли». */
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

const litres = (ml: number): string =>
  ml < 1000 ? `${Math.round(ml)} мл` : `${(Math.round(ml / 100) / 10).toFixed(1).replace(".", ",")} л`;

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}ч ${pad(m)}м` : `${m}м`;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/**
 * Что стоит прислать прямо сейчас.
 *
 * Время сравнивается по «уже наступило», а не «ровно сейчас»: проверка приходит раз в
 * четверть часа и на точную минуту не попадает никогда. Один раз за день — за это отвечает
 * ключ: он же не даёт правилу повторяться каждые пятнадцать минут, пока условие держится.
 */
export function dueAlerts(state: DayState, rules: SmartRules, now: Date, sent: string[]): Alert[] {
  const already = new Set(sent);
  const out: Alert[] = [];
  const nowMin = minutesOf(now);
  const push = (a: Alert) => {
    if (!already.has(a.key)) out.push(a);
  };

  // --- Sterzhen ---
  const left = state.habitsTotal - state.habitsDone;
  if (
    rules.habitsUndone.enabled &&
    state.habitsTotal > 0 &&
    left > 0 &&
    nowMin >= rules.habitsUndone.hour * 60 + rules.habitsUndone.minute
  ) {
    push({
      key: "habits-undone",
      title: "День ещё не закрыт",
      body: `Осталось ${left} ${plural(left, ["привычка", "привычки", "привычек"])} из ${
        state.habitsTotal
      } — время ещё есть.`,
    });
  }

  // --- CaloriX ---
  if (
    rules.diaryEmpty.enabled &&
    state.meals === 0 &&
    nowMin >= rules.diaryEmpty.hour * 60 + rules.diaryEmpty.minute
  ) {
    push({
      key: "diary-empty",
      title: "Дневник пуст",
      body: "За сегодня ни одной записи. Вечером вспомнить труднее, чем кажется.",
    });
  }

  if (rules.water.enabled && state.waterTargetMl > 0 && state.waterMl < state.waterTargetMl) {
    const { fromHour, toHour, everyHours } = rules.water;
    const hour = now.getHours();
    if (hour >= fromHour && hour <= toHour) {
      // Час напоминания — ближайший «шаг» от начала окна, чтобы ключ был один на промежуток,
      // а не один на каждую проверку.
      const step = Math.floor((hour - fromHour) / everyHours);
      push({
        key: `water-${step}`,
        title: "Вода",
        body: `Выпито ${litres(state.waterMl)} из ${litres(state.waterTargetMl)}. Стакан — 250 мл.`,
      });
    }
  }

  // --- Creker ---
  if (state.screenKnown && state.screenLimitMs > 0) {
    const leftMs = state.screenLimitMs - state.screenMs;
    if (rules.screenSoon.enabled && leftMs > 0 && leftMs <= rules.screenSoon.minutesBefore * 60_000) {
      push({
        key: "screen-soon",
        title: "Экран подходит к лимиту",
        body: `Сегодня ${duration(state.screenMs)}, до лимита осталось ${duration(leftMs)}.`,
      });
    }
    if (rules.screenOver.enabled && leftMs <= 0) {
      push({
        key: "screen-over",
        title: "Лимит экрана пройден",
        body: `Сегодня ${duration(state.screenMs)} при лимите ${duration(state.screenLimitMs)}.`,
      });
    }
  }

  return out;
}
