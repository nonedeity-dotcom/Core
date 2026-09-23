import * as ScreenOrientation from "expo-screen-orientation";

/**
 * Поворот экрана.
 *
 * Приложение целиком — вертикальное: экраны с графиками и списками под бок не задуманы.
 * Лечь горизонтально разрешено только играм, и только по кнопке — автоповорот на столе
 * переворачивал бы чек-лист от каждого движения.
 *
 * Ошибки глотаются: в браузере и на части устройств блокировка не поддерживается, и это
 * не повод ронять экран.
 */
export async function lockPortrait(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch {
    // не поддерживается — остаёмся как есть
  }
}

export async function lockLandscape(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch {
    // не поддерживается — остаёмся как есть
  }
}
