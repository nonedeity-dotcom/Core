import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { planReminders, reminderText, type DateEvent } from "./dateEvents";

/**
 * Напоминания о датах: каждое — своё одноразовое локальное уведомление.
 *
 * Не повторяющееся «раз в год» и не фоновая задача, а именно одноразовые на ближайшие
 * повторения. Повтор у системы считается только от одной даты, а напоминание «за неделю до
 * дня рождения» с ним не складывается: у него свой день в каждом месяце. Одноразовые же
 * система доставляет сама, даже когда приложение закрыто и экономия батареи душит
 * фоновые задачи — в отличие от проверки в `background.ts`, которая просыпается раз в
 * четверть часа, если повезёт.
 *
 * Дальние повторения допланируются при каждом открытии Главной: план собирается заново от
 * «сейчас». Пока приложением хоть иногда пользуются, еженедельное событие не кончается.
 *
 * Здесь НЕТ `setNotificationHandler`. Он общий на всё приложение, и если вам нужно, чтобы
 * уведомления показывались, пока приложение открыто, он ставится один раз там, где уже
 * стоит для остальных уведомлений.
 */

const CHANNEL_ID = "date-events";
const PREFIX = "cal:";

/** На вебе и в окружениях без нативных уведомлений планировать нечем. */
const supported = Platform.OS === "android" || Platform.OS === "ios";

export async function hasReminderPermission(): Promise<boolean> {
  if (!supported) return false;
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/** Спрашивает разрешение. Зовётся, когда человек сохраняет событие с напоминаниями, а не при запуске. */
export async function requestReminderPermission(): Promise<boolean> {
  if (!supported) return false;
  try {
    // Канал создаётся до запроса: на Android 13+ системное окно с вопросом появляется
    // только у приложения, у которого уже есть хотя бы один канал.
    await ensureChannel();
    const { granted } = await Notifications.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Даты и события",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/*
 * Очередь: две пересборки подряд (открыли Главную и тут же сохранили событие) иначе
 * переплелись бы — одна снимает старое, пока другая ещё ставит новое, и часть напоминаний
 * пропадает.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Пересобирает напоминания под текущий список событий.
 *
 * Снимается всё своё и ставится заново, а не сверяется по разнице: уведомлений не больше
 * шестидесяти, и это единственный способ, при котором изменённое название или время не
 * остаётся в уже поставленном напоминании. Чужие уведомления не трогаются — свои узнаются
 * по префиксу идентификатора.
 *
 * Возвращает, сколько напоминаний стоит в очереди после пересборки.
 */
export function syncDateReminders(events: DateEvent[]): Promise<number> {
  const run = async (): Promise<number> => {
    if (!supported) return 0;
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const n of scheduled) {
        if (n.identifier.startsWith(PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
      // Без разрешения ставить нечего — но старое всё равно снято выше: удалённое событие
      // не должно напоминать о себе, даже если разрешение потом отозвали.
      if (!(await hasReminderPermission())) return 0;

      await ensureChannel();
      const plan = planReminders(events, new Date());
      for (const r of plan) {
        const event = events.find((e) => e.id === r.eventId);
        if (!event) continue;
        const { title, body } = reminderText(event, r.date, r.lead);
        await Notifications.scheduleNotificationAsync({
          identifier: r.key,
          content: { title, body, data: { dateEventId: r.eventId } },
          trigger: { date: r.at, channelId: CHANNEL_ID },
        });
      }
      return plan.length;
    } catch {
      // Напоминания — дополнение к календарю, а не его суть: сбой планировщика не должен
      // ронять Главную. Следующее открытие попробует снова.
      return 0;
    }
  };

  const next = queue.then(run, run);
  queue = next;
  return next;
}
