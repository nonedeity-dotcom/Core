import { Alert, Platform, type AlertButton } from "react-native";

/**
 * Мост к окну в цветах приложения.
 *
 * `ConfirmHost` при запуске записывает сюда свою функцию показа. Пока она есть, все
 * подтверждения идут через неё — и на телефоне, и в вебе. Раньше веб-сборка звала
 * `window.confirm`, а это белое системное окно браузера, до которого `ConfirmHost` не
 * достаёт. Если окно по какой-то причине не смонтировано, остаётся прежний запасной путь.
 */
type Presenter = (title: string, message: string, buttons: AlertButton[]) => void;
let presenter: Presenter | null = null;

export function registerConfirmPresenter(next: Presenter | null): void {
  presenter = next;
}

/**
 * Yes/no confirmation.
 *
 * `Alert.alert` is the right native control, but react-native-web ships it as
 * an empty no-op (`static alert() {}`) — using it directly would leave the
 * delete buttons doing literally nothing in the web build. Native keeps the
 * real dialog; the web build falls back to `window.confirm`.
 *
 * `destructive` styles the confirm button red on iOS. Off for the questions that are
 * a pause rather than a warning — "are you sure this is the moment to change the
 * rules" is not the same kind of question as "erase this".
 */
export function confirmDestructive(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel = "Удалить",
  destructive = true,
): void {
  const buttons: AlertButton[] = [
    { text: "Отмена", style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ];
  if (presenter) {
    presenter(title, message, buttons);
    return;
  }

  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, buttons);
}

/**
 * Сообщение без вопроса — когда нажатие не может сделать то, чего от него ждут.
 *
 * `Alert.alert` в вебе — пустышка, поэтому здесь та же подмена, что и выше: молчащая
 * кнопка выглядит сломанной, и лучше сказать, почему она не сработала.
 */
export function notify(title: string, message: string): void {
  const buttons: AlertButton[] = [{ text: "Понятно" }];
  if (presenter) {
    presenter(title, message, buttons);
    return;
  }
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message, buttons);
}
