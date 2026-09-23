import { Audio, InterruptionModeAndroid } from "expo-av";
import type { SoundId } from "./game";

/**
 * Звуки «Опушки».
 *
 * Файлы синтезированы скриптом tools/sounds/make-village-sounds.js — свои, без чужих
 * лицензий. Здесь только загрузка и проигрывание.
 *
 * Каждый звук загружается двумя копиями и играет по очереди: иначе второй удар топора,
 * пришедший, пока первый ещё звучит, обрывал бы его на полуслове. Шаг — двумя разными
 * файлами: одинаковые шаги подряд звучат как метроном.
 *
 * Всё тихо глотает ошибки: звук — украшение, и игра без него должна идти дальше.
 */

const FILES: Record<Exclude<SoundId, "step"> | "step1" | "step2" | "amb_day" | "amb_night", number> = {
  step1: require("../../../assets/sounds/village/step1.wav"),
  step2: require("../../../assets/sounds/village/step2.wav"),
  twig: require("../../../assets/sounds/village/twig.wav"),
  pebble: require("../../../assets/sounds/village/pebble.wav"),
  chop: require("../../../assets/sounds/village/chop.wav"),
  stone: require("../../../assets/sounds/village/stone.wav"),
  berries: require("../../../assets/sounds/village/berries.wav"),
  water: require("../../../assets/sounds/village/water.wav"),
  eat: require("../../../assets/sounds/village/eat.wav"),
  craft: require("../../../assets/sounds/village/craft.wav"),
  place: require("../../../assets/sounds/village/place.wav"),
  pickup: require("../../../assets/sounds/village/pickup.wav"),
  sleep: require("../../../assets/sounds/village/sleep.wav"),
  goal: require("../../../assets/sounds/village/goal.wav"),
  nope: require("../../../assets/sounds/village/nope.wav"),
  ui: require("../../../assets/sounds/village/ui.wav"),
  bag: require("../../../assets/sounds/village/bag.wav"),
  amb_day: require("../../../assets/sounds/village/amb_day.wav"),
  amb_night: require("../../../assets/sounds/village/amb_night.wav"),
};

type Effect = Exclude<keyof typeof FILES, "amb_day" | "amb_night">;
export type Ambience = "day" | "night" | null;

/** Насколько каждый звук тише общего уровня: шаги — фон, их не должно быть слышно громче топора. */
const LEVEL: Partial<Record<Effect, number>> = { step1: 0.45, step2: 0.45, ui: 0.6, nope: 0.7 };
const COPIES = 2;

export class VillageSound {
  private pools = new Map<Effect, Audio.Sound[]>();
  private turn = new Map<Effect, number>();
  private ambient: Record<"day" | "night", Audio.Sound | null> = { day: null, night: null };
  private playingAmbient: Ambience = null;
  private stepFoot = 0;
  private closed = false;
  private paused = false;
  private wanted: Ambience = null;
  effects = true;
  volume = 0.7;
  ambienceOn = true;
  ambienceVolume = 0.5;

  async load(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        // Игра не должна глушить чужую музыку насовсем — только приглушать на время звука.
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      });
    } catch {
      // режим не поставился — играем как есть
    }
    const effects = (Object.keys(FILES) as (keyof typeof FILES)[]).filter((k) => !k.startsWith("amb_")) as Effect[];
    await Promise.all(
      effects.map(async (id) => {
        const pool: Audio.Sound[] = [];
        for (let i = 0; i < COPIES; i++) {
          try {
            const { sound } = await Audio.Sound.createAsync(FILES[id], { shouldPlay: false, volume: this.levelOf(id) });
            pool.push(sound);
          } catch {
            // файл не загрузился — этого звука просто не будет
          }
        }
        if (this.closed) pool.forEach((s) => void s.unloadAsync());
        else this.pools.set(id, pool);
      }),
    );
    for (const kind of ["day", "night"] as const) {
      try {
        const { sound } = await Audio.Sound.createAsync(FILES[kind === "day" ? "amb_day" : "amb_night"], {
          shouldPlay: false,
          isLooping: true,
          volume: this.ambienceVolume,
        });
        if (this.closed) void sound.unloadAsync();
        else this.ambient[kind] = sound;
      } catch {
        // без фона
      }
    }
    this.syncAmbience();
  }

  /** Поменялись настройки — применить сразу, в том числе к играющему фону. */
  configure(opts: { effects: boolean; volume: number; ambience: boolean; ambienceVolume: number }): void {
    this.effects = opts.effects;
    this.volume = opts.volume;
    this.ambienceOn = opts.ambience;
    this.ambienceVolume = opts.ambienceVolume;
    this.syncAmbience();
  }

  private levelOf(id: Effect): number {
    return Math.min(1, this.volume * (LEVEL[id] ?? 1));
  }

  play(id: SoundId): void {
    if (!this.effects || this.closed) return;
    const effect: Effect = id === "step" ? (this.stepFoot++ % 2 === 0 ? "step1" : "step2") : id;
    const pool = this.pools.get(effect);
    if (!pool || pool.length === 0) return;
    const n = this.turn.get(effect) ?? 0;
    this.turn.set(effect, n + 1);
    const sound = pool[n % pool.length];
    void sound.setVolumeAsync(this.levelOf(effect)).catch(() => {});
    void sound.replayAsync().catch(() => {});
  }

  /**
   * Фон: дневной лес или ночные сверчки. Запоминается, чего хотят, и включается, как только
   * звуки загрузятся, — просьба, пришедшая раньше загрузки, не теряется.
   */
  setAmbience(kind: Ambience): void {
    this.wanted = kind;
    this.syncAmbience();
  }

  private syncAmbience(): void {
    const want = this.ambienceOn && !this.closed && !this.paused ? this.wanted : null;
    const ready = want ? this.ambient[want] : null;
    const target = ready ? want : null;
    if (target === this.playingAmbient) {
      if (target) void this.ambient[target]?.setVolumeAsync(this.ambienceVolume).catch(() => {});
      return;
    }
    const old = this.playingAmbient;
    this.playingAmbient = target;
    if (old) void this.ambient[old]?.pauseAsync().catch(() => {});
    if (target && ready) {
      void ready.setVolumeAsync(this.ambienceVolume).catch(() => {});
      void ready.playAsync().catch(() => {});
    }
  }

  /** Приложение ушло в фон — фон молчит; вернулось — играет снова. */
  pause(): void {
    this.paused = true;
    this.syncAmbience();
  }

  resume(): void {
    this.paused = false;
    this.syncAmbience();
  }

  unload(): void {
    this.closed = true;
    this.syncAmbience();
    for (const pool of this.pools.values()) pool.forEach((s) => void s.unloadAsync().catch(() => {}));
    this.pools.clear();
    for (const kind of ["day", "night"] as const) void this.ambient[kind]?.unloadAsync().catch(() => {});
  }
}
