import { Platform, Vibration } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import type { FocusPhase } from "../lib/focusPhases";
import { requestNotificationPermission } from "./reminders";
import { PHASE_LABELS } from "../lib/focusPhases";

/**
 * Making the phone ring when a focus phase runs out.
 *
 * Two mechanisms, because one cannot cover both cases:
 *
 * - **App open.** JS is running, so the chosen file is played through expo-av and the
 *   phone vibrates. This is where a custom sound actually happens.
 * - **App backgrounded or screen off.** JS is suspended — the whole point of this timer is
 *   that the phone is face-down in another room — so nothing of ours can run at the
 *   deadline. A local notification is scheduled the moment the phase starts and cancelled
 *   if it is paused or reset. That one rings with its Android channel's sound, which the OS
 *   fixes at install time from a bundled resource: a file picked at runtime cannot be it.
 *
 * So a chosen sound is what you hear with the app in front of you, and the notification is
 * what reaches you when it isn't. Both vibrate.
 */

const SOUNDS_KEY = "focus-sounds-v1";
/**
 * Scheduled notification ids, one per phase.
 *
 * A single id was enough while there was one clock; with the boredom timer running beside
 * the work/break ring, cancelling on pause has to cancel *that* timer's alarm and leave the
 * other one armed.
 */
const SCHEDULED_KEY = "focus-chime-ids-v1";
/**
 * В имени канала стоит версия, и это не украшение.
 *
 * Android фиксирует важность и звук канала в момент создания и потом их не меняет: канал,
 * заведённый прошлой сборкой тихим, останется тихим, сколько его ни переписывай. Единственный
 * способ починить звук — завести новый канал, поэтому у имени есть номер.
 */
export const CHANNEL_ID = "focus-timer-v2";

/** Where a picked file is copied to, so it survives the picker's temp cache being cleared. */
const SOUND_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}focus-sounds/` : null;

export interface PhaseSound {
  /** Local file:// uri of the copy this app owns. */
  uri: string;
  /** The original file name, which is the only thing worth showing in a list. */
  name: string;
}

/** One entry per phase; a missing entry means the default chime. */
export type FocusSounds = Partial<Record<FocusPhase, PhaseSound>>;

function isSound(v: unknown): v is PhaseSound {
  if (typeof v !== "object" || v === null) return false;
  const { uri, name } = v as Record<string, unknown>;
  return typeof uri === "string" && uri.length > 0 && typeof name === "string";
}

export async function getFocusSounds(): Promise<FocusSounds> {
  try {
    const raw = await AsyncStorage.getItem(SOUNDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: FocusSounds = {};
    for (const phase of ["boredom", "work", "break"] as FocusPhase[]) {
      const v = parsed[phase];
      if (isSound(v)) out[phase] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeSounds(sounds: FocusSounds): Promise<void> {
  await AsyncStorage.setItem(SOUNDS_KEY, JSON.stringify(sounds));
}

/**
 * What happened when the user tried to choose a file.
 *
 * "cancelled" is not a failure and must not be reported as one; "unplayable" is the case
 * that matters — a file the picker happily returns and the player cannot open. It is caught
 * here, by loading the sound before saving it, rather than at the end of the first work
 * block when nothing rings.
 */
export type PickResult =
  | { status: "picked"; sound: PhaseSound }
  | { status: "cancelled" }
  | { status: "unplayable"; detail?: string };

export async function pickPhaseSound(phase: FocusPhase): Promise<PickResult> {
  let picked: DocumentPicker.DocumentPickerAsset;
  try {
    const res = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return { status: "cancelled" };
    picked = res.assets[0];
  } catch (e) {
    return { status: "unplayable", detail: (e as Error)?.message };
  }

  // Copied into our own directory: the picker hands back a cache path the OS is free to
  // delete, and a sound that stops working next week is worse than one that never started.
  let uri = picked.uri;
  try {
    if (SOUND_DIR) {
      await FileSystem.makeDirectoryAsync(SOUND_DIR, { intermediates: true });
      const target = `${SOUND_DIR}${phase}-${Date.now()}`;
      await FileSystem.copyAsync({ from: picked.uri, to: target });
      uri = target;
    }
  } catch {
    // Keep the original path rather than failing: a sound that might not survive a cache
    // sweep still beats no sound at all.
  }

  // Prove it plays before it becomes the setting.
  try {
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    await sound.unloadAsync();
  } catch (e) {
    return { status: "unplayable", detail: (e as Error)?.message };
  }

  const entry: PhaseSound = { uri, name: picked.name || PHASE_LABELS[phase] };
  const sounds = await getFocusSounds();
  await writeSounds({ ...sounds, [phase]: entry });
  return { status: "picked", sound: entry };
}

/** Back to the built-in chime for this phase. */
export async function clearPhaseSound(phase: FocusPhase): Promise<void> {
  const sounds = await getFocusSounds();
  delete sounds[phase];
  await writeSounds(sounds);
}

let current: Audio.Sound | null = null;

async function stopCurrent() {
  const sound = current;
  current = null;
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch {
    // Already finished; unloading below is what actually matters.
  }
  try {
    await sound.unloadAsync();
  } catch {
    // Nothing to do — the handle is being dropped either way.
  }
}

/**
 * The sound for a phase, right now, with the app in front of you.
 *
 * Returns what it managed to do rather than throwing: the caller shows "прозвенело" or
 * "не удалось воспроизвести", and a phase ending is not a moment to crash a screen.
 */
export async function playPhaseChime(phase: FocusPhase): Promise<"played" | "vibrated" | "failed"> {
  // Vibration first, always: it is the part that works with the volume down, and it should
  // not be lost because a file went missing.
  try {
    Vibration.vibrate([0, 400, 200, 400, 200, 600]);
  } catch {
    // Web, or a device without a motor.
  }

  const sounds = await getFocusSounds();
  const chosen = sounds[phase];
  if (!chosen) return "vibrated";

  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      // The timer ending is the point of the timer — it should not be quiet because
      // something else is playing.
      shouldDuckAndroid: false,
    });
    await stopCurrent();
    const { sound } = await Audio.Sound.createAsync({ uri: chosen.uri }, { shouldPlay: true, volume: 1 });
    current = sound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if ("didJustFinish" in status && status.didJustFinish) void stopCurrent();
    });
    return "played";
  } catch {
    // A file that has been moved or deleted since it was chosen. The buzz already happened.
    return "vibrated";
  }
}

/** Cuts a chime short — used when the ringing phase is dismissed. */
export async function stopChime(): Promise<void> {
  await stopCurrent();
}

/**
 * The Android channel the deadline notification uses.
 *
 * Without one, expo-notifications lands everything on a default channel whose importance
 * the user can only guess at. This one is explicitly high with vibration, because a timer
 * that ends silently in the notification shade is a timer that did not go off.
 */
export async function ensureChimeChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Таймер фокуса",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 400, 200, 400],
      sound: "default",
      enableVibrate: true,
    });
  } catch {
    // Older Android, or notifications unavailable — the foreground chime still works.
  }
}

/**
 * Arms the backup alarm for a phase that has just started.
 *
 * Cancels whatever was armed before, so pausing and restarting cannot leave two of them
 * queued. Returns false when nothing could be scheduled, which is the honest answer to
 * "will it ring if I put the phone down" and is what the screen shows.
 */
export async function scheduleChime(phase: FocusPhase, deadline: number): Promise<boolean> {
  await cancelChime(phase);
  const seconds = Math.round((deadline - Date.now()) / 1000);
  if (seconds <= 0) return false;
  // Без разрешения система принимает будильник и молча его не показывает: приложение
  // считало, что всё в порядке, а телефон в кармане молчал. Спрашиваем здесь — момент
  // запуска таймера и есть тот, когда просьба понятна.
  if (!(await requestNotificationPermission())) return false;
  try {
    await ensureChimeChannel();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${PHASE_LABELS[phase][0].toUpperCase()}${PHASE_LABELS[phase].slice(1)} — время вышло`,
        body:
          phase === "work"
            ? "Блок закончен. Перерыв — без телефона."
            : phase === "boredom"
              ? "Разгрузка закончена. Можно начинать работу."
              : "Перерыв закончен. Возвращайся в работу.",
        sound: true,
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: { seconds, channelId: CHANNEL_ID },
    });
    const ids = await readScheduled();
    await writeScheduled({ ...ids, [phase]: id });
    return true;
  } catch {
    return false;
  }
}

async function readScheduled(): Promise<Partial<Record<FocusPhase, string>>> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<FocusPhase, string>> = {};
    for (const phase of ["boredom", "work", "break"] as FocusPhase[]) {
      const v = parsed[phase];
      if (typeof v === "string" && v) out[phase] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeScheduled(ids: Partial<Record<FocusPhase, string>>): Promise<void> {
  try {
    await AsyncStorage.setItem(SCHEDULED_KEY, JSON.stringify(ids));
  } catch {
    // Nothing depends on the key being clean; ids are re-written on the next schedule.
  }
}

/**
 * Drops an armed alarm — on pause, on reset, and when a phase ends with the app open.
 *
 * With no argument it drops all of them, which is what a reset means. With a phase it drops
 * only that one, so pausing the boredom clock cannot silence a work block still running.
 */
export async function cancelChime(phase?: FocusPhase): Promise<void> {
  const ids = await readScheduled();
  const targets = phase ? ([phase] as FocusPhase[]) : (Object.keys(ids) as FocusPhase[]);
  for (const t of targets) {
    const id = ids[t];
    if (!id) continue;
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Already fired or already gone.
    }
    delete ids[t];
  }
  await writeScheduled(ids);
}
