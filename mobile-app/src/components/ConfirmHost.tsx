import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, Text, View, type AlertButton } from "react-native";
import { colors, withAlpha } from "../theme/colors";
import { registerConfirmPresenter } from "../lib/confirm";

/**
 * Окно подтверждения в цветах приложения вместо белого системного.
 *
 * `Alert.alert` рисует родное окно Android, и оно всегда светлое: ни цвета, ни шрифта,
 * ни скруглений приложения туда не передать. Поэтому при запуске эта вставка подменяет
 * сам `Alert.alert` — и всё, что его зовёт (`confirmDestructive`, `notify` из lib/confirm
 * и прямые вызовы на экранах), начинает показывать это окно, а менять каждое место не нужно.
 *
 * Окна идут по очереди: если за первым сразу просится второе, оно появится после него.
 *
 * Цвета берутся при показе, а не при загрузке файла: акцент выбирается в «Наградах» и
 * подставляется в `colors` после того, как этот файл уже загружен.
 */
interface Request {
  title: string;
  message: string;
  buttons: AlertButton[];
  onDismiss?: () => void;
}

/**
 * Текст предупреждения. Он светлый, а не серый — это то, ради чего окно открылось, и читать
 * его надо, а не угадывать. Выделяется то, что в «ёлочках» (обычно название привычки или
 * настройки) и то, что в **двойных звёздочках**: жирным и тёплым акцентом.
 */
function Message({ text }: { text: string }) {
  if (text === "") return null;
  const parts = text.split(/(«[^»]*»|\*\*[^*]+\*\*)/g);
  return (
    <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 12 }}>
      {parts.map((part, i) => {
        const guillemets = part.length > 1 && part.startsWith("«") && part.endsWith("»");
        const stars = part.length > 4 && part.startsWith("**") && part.endsWith("**");
        if (!guillemets && !stars) return part;
        return (
          <Text key={i} style={{ color: colors.accent, fontWeight: "700" }}>
            {stars ? part.slice(2, -2) : part}
          </Text>
        );
      })}
    </Text>
  );
}

/** Окраска кнопки: как у остальных кнопок приложения — тёплая «осторожно», зелёная «да», тихая «отмена». */
function tone(style: AlertButton["style"]) {
  if (style === "destructive") {
    return { ink: colors.accent, fill: withAlpha(colors.accent, 0.16), line: withAlpha(colors.accent, 0.55) };
  }
  if (style === "cancel") {
    return { ink: colors.text, fill: colors.bg, line: colors.cardBorder };
  }
  return { ink: colors.accentGreen, fill: "rgba(143,184,154,0.12)", line: colors.accentGreen };
}

export default function ConfirmHost() {
  const [queue, setQueue] = useState<Request[]>([]);

  useEffect(() => {
    const enqueue = (request: Request) => setQueue((q) => [...q, request]);
    const patchable = Alert as unknown as { alert: typeof Alert.alert };
    const original = patchable.alert;
    patchable.alert = (title, message, buttons, options) => {
      enqueue({
        title,
        message: message ?? "",
        buttons: buttons && buttons.length > 0 ? buttons : [{ text: "Понятно" }],
        onDismiss: options?.onDismiss,
      });
    };
    // Тот же путь для confirmDestructive / notify: в вебе они иначе уходят в белый window.confirm.
    registerConfirmPresenter((title, message, buttons) =>
      enqueue({ title, message, buttons: buttons.length > 0 ? buttons : [{ text: "Понятно" }] }),
    );
    return () => {
      patchable.alert = original;
      registerConfirmPresenter(null);
    };
  }, []);

  const current = queue[0];
  // Пока окно гаснет, очередь уже пуста; без запомненного содержимого оно исчезало бы рывком.
  const shown = useRef<Request | undefined>(undefined);
  if (current) shown.current = current;
  const request = shown.current;

  const close = (button?: AlertButton) => {
    setQueue((q) => q.slice(1));
    if (button) button.onPress?.();
    else current?.onDismiss?.();
  };

  return (
    <Modal
      visible={current !== undefined}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close()}
    >
      <View
        accessibilityViewIsModal
        style={{ flex: 1, backgroundColor: "rgba(8,10,13,0.72)", justifyContent: "center", padding: 28 }}
      >
        {request && (
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 22,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600", lineHeight: 23 }}>
              {request.title}
            </Text>
            <Message text={request.message} />

            <View
              style={{
                flexDirection: request.buttons.length === 2 ? "row" : "column",
                gap: 10,
                marginTop: 20,
              }}
            >
              {request.buttons.map((button, i) => {
                const t = tone(button.style);
                return (
                  <Pressable
                    key={`${i}-${button.text ?? ""}`}
                    onPress={() => close(button)}
                    accessibilityRole="button"
                    accessibilityLabel={button.text}
                    style={({ pressed }) => ({
                      flex: request.buttons.length === 2 ? 1 : undefined,
                      alignItems: "center",
                      paddingVertical: 13,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: t.line,
                      backgroundColor: t.fill,
                      opacity: pressed ? 0.75 : 1,
                    })}
                  >
                    <Text
                      style={{
                        color: t.ink,
                        fontSize: 14,
                        fontWeight: button.style === "cancel" ? "500" : "600",
                      }}
                    >
                      {button.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
