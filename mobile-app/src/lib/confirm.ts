import { Alert, Platform } from "react-native";

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
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: "Отмена", style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}
