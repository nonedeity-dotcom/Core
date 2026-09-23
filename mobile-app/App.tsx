import { useEffect, useState, type ComponentType } from "react";
import { AppState, View } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/api/queryClient";
import { api } from "./src/api/client";
import { colors } from "./src/theme/colors";
import { accentColor } from "./src/lib/rewards/catalog";
import { restoreReminder } from "./src/notifications/reminders";
import { checkAndNotify } from "./src/notifications/watchers";
import { setBackgroundCheck } from "./src/notifications/background";
import { lockPortrait } from "./src/lib/orientation";

/**
 * Разделы грузятся отложенно — и только ради акцентного цвета.
 *
 * Стили в React Native собираются в момент загрузки файла экрана и запоминают цвета
 * значениями: `StyleSheet.create` не пересчитывается никогда. Поэтому поменять акцент,
 * когда экраны уже загружены, нельзя — можно только загрузить их после того, как цвет
 * подставлен. Отсюда и эта задержка: сначала читается кошелёк, потом появляется всё
 * остальное.
 *
 * Ждать приходится одно чтение из хранилища, и за него платится пустым экраном на кадр.
 * Обещать мгновенную смену цвета и подсунуть перезапуск было бы хуже.
 *
 * Загрузка идёт через `require`, а не через `import()`: динамический импорт сборщик уводит
 * в отдельный кусок бандла, и веб-сборка падала на «Requiring unknown module». `require`
 * берёт модуль из того же бандла и делает это тогда, когда его позвали.
 */
declare function require(path: string): { default: ComponentType };

const loadRoot = (): ComponentType => require("./src/navigation/RootTabs").default;

export default function App() {
  const [Root, setRoot] = useState<ComponentType | null>(null);

  useEffect(() => {
    void api
      .getPurse()
      .then((purse) => {
        colors.accent = accentColor(purse.equipped.accent);
      })
      // Акцент — украшение. Не прочитался кошелёк — остаётся родной цвет, а приложение
      // всё равно открывается: падать из-за цвета нечестно.
      .catch(() => {})
      // Обёртка обязательна: useState принимает функцию за «посчитай новое значение», а
      // компонент — это функция, и без неё React вызвал бы его вместо того, чтобы сохранить.
      .finally(() => setRoot(() => loadRoot()));
  }, []);

  useEffect(() => {
    // Экран в манифесте теперь может поворачиваться — ради игр. Всё остальное держим
    // вертикальным, как было.
    void lockPortrait();
    restoreReminder();

    /**
     * Проверка дня — при каждом открытии и возвращении из фона.
     *
     * Фоновая задача обещает раз в четверть часа и обещание держит нестрого; открытие
     * приложения — момент, когда всё известно точно. Поэтому оба: фон ловит то, что
     * случилось, пока приложение закрыто, а открытие догоняет пропущенное.
     */
    const check = () => {
      void checkAndNotify().then((r) => void setBackgroundCheck(r.reason !== "off"));
    };
    check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {Root ? <Root /> : <View style={{ flex: 1, backgroundColor: colors.bg }} />}
    </QueryClientProvider>
  );
}
