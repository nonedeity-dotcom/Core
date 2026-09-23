/**
 * Настройки «Опушки» — этого телефона, а не мира: в резервную копию не едут. Перенёс игру
 * на другой телефон — там свои руки, своё удобство и своя громкость.
 */

export type ControlMode = "stick" | "dpad" | "tap";
export type Size = "small" | "normal" | "large";
export type Speed = "slow" | "normal" | "fast";
export type Volume = "quiet" | "normal" | "loud";

export interface VillageSettings {
  /** Экран лежит набок. */
  landscape: boolean;
  /** Джойстик, крестовина или только касание по карте. */
  control: ControlMode;
  /** С какой стороны джойстик — для левшей справа. */
  padSide: "left" | "right";
  buttons: Size;
  speed: Speed;
  /** Ходить, нажимая на карту. При «только касание» включено всегда. */
  tapToWalk: boolean;
  sound: boolean;
  volume: Volume;
  /** Звуки леса: днём ветер и птицы, ночью сверчки. */
  ambience: boolean;
  vibration: boolean;
  /** Строка с задачей наверху. */
  showGoal: boolean;
  /** Рамка вокруг клетки, к которой повернулся. */
  showTarget: boolean;
}

export const DEFAULT_SETTINGS: VillageSettings = {
  landscape: false,
  control: "stick",
  padSide: "left",
  buttons: "normal",
  speed: "normal",
  tapToWalk: true,
  sound: true,
  volume: "normal",
  ambience: true,
  vibration: true,
  showGoal: true,
  showTarget: true,
};

/** Сколько миллисекунд между шагами. */
export const STEP_MS: Record<Speed, number> = { slow: 210, normal: 155, fast: 110 };
/** Во сколько раз крупнее кнопки. */
export const BUTTON_SCALE: Record<Size, number> = { small: 0.85, normal: 1, large: 1.18 };
/** Громкость эффектов и фона. Фон всегда заметно тише — он не должен спорить со звуками дела. */
export const VOLUME: Record<Volume, { effects: number; ambience: number }> = {
  quiet: { effects: 0.35, ambience: 0.18 },
  normal: { effects: 0.7, ambience: 0.35 },
  loud: { effects: 1, ambience: 0.55 },
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Прочитать сохранённое. Что непонятно — по умолчанию; старое `{ landscape }` читается как есть. */
export function normalizeSettings(raw: unknown): VillageSettings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    landscape: bool(o.landscape, d.landscape),
    control: pick(o.control, ["stick", "dpad", "tap"] as const, d.control),
    padSide: pick(o.padSide, ["left", "right"] as const, d.padSide),
    buttons: pick(o.buttons, ["small", "normal", "large"] as const, d.buttons),
    speed: pick(o.speed, ["slow", "normal", "fast"] as const, d.speed),
    tapToWalk: bool(o.tapToWalk, d.tapToWalk),
    sound: bool(o.sound, d.sound),
    volume: pick(o.volume, ["quiet", "normal", "loud"] as const, d.volume),
    ambience: bool(o.ambience, d.ambience),
    vibration: bool(o.vibration, d.vibration),
    showGoal: bool(o.showGoal, d.showGoal),
    showTarget: bool(o.showTarget, d.showTarget),
  };
}

/** Можно ли сейчас ходить нажатием на карту. Без крестовины это единственный способ. */
export const canTapWalk = (s: VillageSettings): boolean => s.control === "tap" || s.tapToWalk;
