import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { checkAndNotify } from "./watchers";

/**
 * Проверка дня, пока приложение закрыто.
 *
 * Без неё «за час до лимита экрана» не работает вовсе: число растёт, пока телефоном
 * пользуются, а приложение в это время не запущено и ничего не знает.
 *
 * Честно про то, что обещает Android. Фоновой задаче он даёт просыпаться **не чаще раза в
 * четверть часа**, и это не расписание, а пожелание: в спящем режиме и при экономии батареи
 * он откладывает её на потом, а некоторые оболочки — Xiaomi, HiOS — убивают такие задачи
 * вовсе. Поэтому «за час до лимита» на деле означает «где-то между часом и сорока минутами»,
 * а иногда не означает ничего. Лечится это отключением экономии батареи для приложения —
 * туда ведёт кнопка на экране уведомлений.
 *
 * Из-за этого фоновая проверка — не единственная: то же самое делается при каждом открытии
 * приложения, и там всё точно.
 */

export const TASK_NAME = "core-day-check";

/** Минимум, который принимает Android. Просить чаще бессмысленно — он всё равно округлит. */
const INTERVAL_SECONDS = 15 * 60;

/**
 * Задача объявляется на уровне модуля, а не в компоненте.
 *
 * Система запускает её в свежем процессе, где ни одного экрана ещё нет: к этому моменту
 * задача уже должна быть объявлена, иначе просыпание уйдёт в пустоту.
 */
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const result = await checkAndNotify();
    return result.sent > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Включить или выключить фоновую проверку.
 *
 * Регистрация повторяется без вреда, а снятие с регистрации нужно, когда все правила
 * выключены: будить процесс раз в четверть часа ради того, чтобы ничего не сделать, — это
 * плата батареей ни за что.
 */
export async function setBackgroundCheck(enabled: boolean): Promise<boolean> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!enabled) {
      if (registered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
      return false;
    }
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: INTERVAL_SECONDS,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    return true;
  } catch {
    // Веб, эмулятор без сервисов Google или платформа без фоновых задач: проверка при
    // открытии приложения работает и без этого.
    return false;
  }
}
