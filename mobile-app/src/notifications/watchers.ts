import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../api/client";
import { todayKey } from "../lib/date";
import { dayProgress, habitsThatDecideTheDay } from "../lib/habits";
import { sumNutrition } from "../lib/balance/food";
import { targets } from "../lib/balance/profile";
import { waterFor, waterTarget } from "../lib/balance/water";
import { totalScreenMillis } from "../lib/screen/usage";
import { hasUsageAccess } from "../../modules/creker-usage";
import { syncUsage } from "../integrations/usageSync";
import { dueAlerts, normalizeRules, DEFAULT_RULES, type DayState, type SmartRules } from "../lib/notify/rules";
import { requestNotificationPermission } from "./reminders";
import type { Habit, HabitLog } from "../types";

/**
 * Проверка дня и отправка того, о чём есть что сказать.
 *
 * Здесь всё, что нельзя проверить в node: чтение хранилища, доступ к системной статистике и
 * сама отправка. Решение, что именно прислать, живёт отдельно — в `lib/notify/rules.ts`, и
 * проверяется на числах.
 *
 * Проверка запускается из двух мест: при каждом открытии приложения и раз в четверть часа
 * фоновой задачей. Второе Android обещает нестрого — может отложить или пропустить, — и
 * поэтому первое остаётся: открыл приложение, и всё, что накопилось, придёт сразу.
 */

const RULES_KEY = "smart-rules-v1";
const SENT_KEY = "smart-sent-v1";
export const SMART_CHANNEL_ID = "core-smart-v1";

export async function getSmartRules(): Promise<SmartRules> {
  try {
    const raw = await AsyncStorage.getItem(RULES_KEY);
    return raw ? normalizeRules(JSON.parse(raw)) : { ...DEFAULT_RULES };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

export async function setSmartRules(rules: SmartRules): Promise<SmartRules> {
  const clean = normalizeRules(rules);
  try {
    await AsyncStorage.setItem(RULES_KEY, JSON.stringify(clean));
  } catch {
    // Не записалось — настройка не сохранится, но проверка на этом не ломается.
  }
  return clean;
}

/** Что уже присылали сегодня. С новым днём список обнуляется сам. */
async function readSent(date: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { date?: unknown; keys?: unknown };
    if (parsed.date !== date || !Array.isArray(parsed.keys)) return [];
    return parsed.keys.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}

async function writeSent(date: string, keys: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SENT_KEY, JSON.stringify({ date, keys }));
  } catch {
    // То же самое: в худшем случае напоминание придёт дважды, а не потеряется.
  }
}

/**
 * Канал с новым именем, а не правка старого.
 *
 * Android фиксирует важность и звук канала в момент создания и потом их не меняет: канал,
 * заведённый когда-то тихим, тихим и останется, сколько его ни переписывай. Поэтому у канала
 * в имени стоит версия — поменялись настройки, поменялся и он.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(SMART_CHANNEL_ID, {
      name: "Core",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
      enableVibrate: true,
    });
  } catch {
    // Старый Android или уведомления недоступны — отправка сама разберётся.
  }
}

/** Состояние сегодняшнего дня — то, на что смотрят правила. */
export async function collectDayState(date = todayKey()): Promise<DayState> {
  const [habits, logs, profile, meals, waterLog, screenDays, limitMin] = await Promise.all([
    api.getHabits() as Promise<Habit[]>,
    api.getHabitLog(date, date) as Promise<HabitLog[]>,
    api.getBalanceProfile(),
    api.getFoodLog(date, date),
    api.getWaterLog(),
    api.getScreenDays(date, date),
    api.getScreenTimeLimitMinutes(),
  ]);

  const deciding = habitsThatDecideTheDay(habits, date);
  const done = deciding.filter((h) => {
    const p = dayProgress(h, logs, date);
    return p.count >= p.target;
  }).length;

  return {
    habitsDone: done,
    habitsTotal: deciding.length,
    meals: meals.length,
    waterMl: waterFor(waterLog, date),
    waterTargetMl: profile ? waterTarget(profile) : 0,
    screenMs: totalScreenMillis(screenDays),
    screenLimitMs: limitMin * 60_000,
    screenKnown: screenDays.length > 0,
  };
}

/** Съеденное за день — для тех правил, которым важны калории. Пока не используется. */
export const eatenToday = sumNutrition;
/** Норма — та же, что на экране. Держится рядом, чтобы правила и экран не разошлись. */
export const dayTargets = targets;

export interface CheckResult {
  /** Сколько уведомлений ушло. Ноль — обычный, нормальный исход. */
  sent: number;
  /** Почему ничего не ушло, если причина не в «нечего сказать». */
  reason?: "permission" | "off";
}

/**
 * Посмотреть на день и прислать то, что просили.
 *
 * Разрешение спрашивается только когда есть что слать: просить доступ к уведомлениям ради
 * проверки, которая всё равно промолчит, — это диалог из ниоткуда.
 *
 * Экранное время перед проверкой пересчитывается: оно копится, пока приложение закрыто, и
 * без пересчёта правило про лимит смотрело бы на число из прошлого захода.
 */
export async function checkAndNotify(now = new Date()): Promise<CheckResult> {
  const rules = await getSmartRules();
  const anyOn =
    rules.habitsUndone.enabled ||
    rules.diaryEmpty.enabled ||
    rules.water.enabled ||
    rules.screenSoon.enabled ||
    rules.screenOver.enabled;
  if (!anyOn) return { sent: 0, reason: "off" };

  if (hasUsageAccess()) {
    try {
      await syncUsage(now.getTime());
    } catch {
      // Не пересчиталось — правила посмотрят на последнее, что сохранено.
    }
  }

  const date = todayKey();
  const [state, sentKeys] = await Promise.all([collectDayState(date), readSent(date)]);
  const alerts = dueAlerts(state, rules, now, sentKeys);
  if (alerts.length === 0) return { sent: 0 };

  if (!(await requestNotificationPermission())) return { sent: 0, reason: "permission" };
  await ensureChannel();

  const delivered: string[] = [];
  for (const alert of alerts) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: alert.title,
          body: alert.body,
          sound: true,
          ...(Platform.OS === "android" ? { channelId: SMART_CHANNEL_ID } : {}),
        },
        // Ближайшая возможная секунда, а не «сейчас»: моментальная отправка на Android
        // иногда молча теряется, а односекундный таймер доезжает всегда.
        trigger: { seconds: 1, channelId: SMART_CHANNEL_ID },
      });
      delivered.push(alert.key);
    } catch {
      // Одно не ушло — остальные всё равно стоит попробовать.
    }
  }
  if (delivered.length > 0) await writeSent(date, [...sentKeys, ...delivered]);
  return { sent: delivered.length };
}

/**
 * Закрыт ли день по привычкам — для обычных напоминаний Sterzhen.
 *
 * Напоминание про чек-лист, приходящее после того, как чек-лист закрыт, — это шум, который
 * учит смахивать не читая. Проверяется в момент открытия приложения: расписание у обычных
 * напоминаний своё, отменять его целиком нельзя, но можно не показывать сегодняшнее.
 */
export async function habitsAllDone(date = todayKey()): Promise<boolean> {
  const state = await collectDayState(date);
  return state.habitsTotal > 0 && state.habitsDone >= state.habitsTotal;
}
