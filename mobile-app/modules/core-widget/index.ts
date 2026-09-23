import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

interface CoreWidgetNativeModule {
  setSnapshot(json: string): boolean;
  takePending(): string;
}

// Как у creker-usage: без нативной сборки (веб, проверки) модуля нет, и оба вызова тихо
// ничего не делают — виджета там всё равно нет.
const native = Platform.OS === "android" ? requireOptionalNativeModule<CoreWidgetNativeModule>("CoreWidget") : null;

export const widgetAvailable = native !== null;

/** Положить виджету слепок «сегодня» и перерисовать его. */
export function setWidgetSnapshot(json: string): void {
  if (!native) return;
  try {
    native.setSnapshot(json);
  } catch {
    // Виджет — витрина. Не обновился — приложение от этого не должно падать.
  }
}

/** Нажатия на виджете, которых приложение ещё не видело. Забираются один раз. */
export function takeWidgetTaps(): string {
  if (!native) return "[]";
  try {
    return native.takePending();
  } catch {
    return "[]";
  }
}
