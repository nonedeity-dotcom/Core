import { useEffect } from "react";
import { AppState } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/api/queryClient";
import RootTabs from "./src/navigation/RootTabs";
import { restoreReminder } from "./src/notifications/reminders";
import { checkAndNotify } from "./src/notifications/watchers";
import { setBackgroundCheck } from "./src/notifications/background";

export default function App() {
  useEffect(() => {
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
      <RootTabs />
    </QueryClientProvider>
  );
}
