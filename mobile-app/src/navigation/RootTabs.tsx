import { useEffect, useState } from "react";
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BackHandler, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme/colors";

import TodayScreen from "../screens/TodayScreen";
import FocusScreen from "../screens/FocusScreen";
import EnergyScreen from "../screens/EnergyScreen";
import ReportScreen from "../screens/ReportScreen";
import StatsScreen from "../screens/StatsScreen";
import ReminderScreen from "../screens/ReminderScreen";
import SettingsScreen from "../screens/SettingsScreen";
import LibraryScreen from "../screens/LibraryScreen";
import ArchiveScreen from "../screens/ArchiveScreen";
import AdminScreen from "../screens/AdminScreen";
import HeaderRefresh from "../components/HeaderRefresh";
import PhasesScreen from "../screens/PhasesScreen";
import HabitReportScreen from "../screens/HabitReportScreen";
import HabitsReportScreen from "../screens/HabitsReportScreen";
import GoalsScreen, { goalsScreenTitle } from "../screens/GoalsScreen";
import GoalScreen, { goalScreenTitle } from "../screens/GoalScreen";
import BalanceProfileScreen from "../screens/balance/ProfileScreen";
import DiaryScreen from "../screens/balance/DiaryScreen";
import AddFoodScreen from "../screens/balance/AddFoodScreen";
import BalanceStatsScreen from "../screens/balance/StatsScreen";
import UsageScreen from "../screens/screen/UsageScreen";
import AppUsageScreen from "../screens/screen/AppUsageScreen";
import HomeScreen from "../screens/HomeScreen";
import GamesScreen from "../screens/games/GamesScreen";
import WordSearchScreen from "../screens/games/WordSearchScreen";
import WheelScreen from "../screens/games/WheelScreen";
import ShopSection from "../screens/shop/ShopSection";
import ProfileSection from "../screens/profile/ProfileSection";
import SectionBar from "./SectionBar";
import TabbedSection from "./TabbedSection";
import MoreScreen from "../screens/MoreScreen";
import { SECTION_TITLES, type Section } from "./sections";
import { CHANNEL_LABELS, type ReminderChannel } from "../notifications/reminders";
import { useWidgetSync } from "../integrations/widget";

// Меню разделов живёт рядом с навигатором, а не внутри экрана, поэтому своего `navigation`
// у него нет: переход в настройки идёт через ссылку на контейнер.
const navRef = createNavigationContainerRef();

/** Насколько глубоко помнится путь по разделам. Дальше — уже не «назад», а история. */
const SECTION_HISTORY = 10;

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.card, border: colors.cardBorder },
};


// A stack around the tabs, so settings and the reference can be pushed on top
// instead of competing for a seventh slot in the bottom bar — seven labels only
// just fit at 320px, and an eighth does not fit at all.
export default function RootTabs() {
  // Виджет на рабочем столе: забрать нажатия, отдать свежий «сегодня».
  useWidgetSync();

  /**
   * Разделы, через которые прошли, а не один текущий.
   *
   * Раздел живёт здесь, а не в навигаторе: это не экран, на который переходят, а то, чем
   * приложение сейчас является. Но кнопка «назад» на телефоне про это не знала и закрывала
   * приложение из любого раздела — хотя человек шёл сюда через Главную и ждёт вернуться
   * ровно туда. Поэтому переходы между разделами складываются в стопку, и «назад» снимает
   * с неё по одному.
   *
   * Стопка живёт ровно столько, сколько живёт процесс: ушёл в фон и вернулся — остаёшься
   * там, где был; закрыл приложение совсем — открывается Главная.
   */
  const [history, setHistory] = useState<Section[]>(["home"]);
  const section = history[history.length - 1];

  /** Открыть раздел. Повторный выбор того же самого стопку не растит. */
  const openSection = (next: Section) =>
    setHistory((h) => (h[h.length - 1] === next ? h : [...h, next].slice(-SECTION_HISTORY)));

  /**
   * Кнопка «назад» на телефоне.
   *
   * Сначала слово навигатору: пока сверху лежит открытый экран — настройки, справочник,
   * приложение из «Экрана» — «назад» закрывает его, и это его работа. Дальше очередь
   * разделов: снимаем верхний и возвращаемся в предыдущий. Пустая стопка — единственный
   * случай, когда приложение действительно закрывается.
   *
   * Обработчик ставится позже навигационного, а система спрашивает их с конца — поэтому
   * наш отвечает первым и обязан честно сказать «не моё», вернув false.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (navRef.isReady() && navRef.canGoBack()) return false;
      if (history.length > 1) {
        setHistory((h) => h.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [history.length]);

  return (
    <NavigationContainer theme={navTheme} ref={navRef}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text, fontSize: 16, fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="Tabs"
          options={() => ({
            // Заголовок называет раздел, а не экран: кнопка внизу показывает, где ты, но
            // подсвеченная иконка в десять точек — самый тихий способ это сказать.
            headerTitle: SECTION_TITLES[section],
            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {section === "sterzhen" && <HeaderRefresh />}
              </View>
            ),
          })}
        >
          {({ navigation }) => (
            <View style={{ flex: 1 }}>
              <View style={{ flex: 1 }}>
                {section === "home" ? (
                  <HomeScreen onOpen={openSection} />
                ) : section === "sterzhen" ? (
                  <TabbedSection
                    tabs={[
                      { title: "Отчёт", render: () => <ReportScreen navigation={navigation} /> },
                      { title: "Чек-лист", render: () => <TodayScreen /> },
                      { title: "Фокус", render: () => <FocusScreen /> },
                      { title: "Энергия", render: () => <EnergyScreen /> },
                      { title: "Статистика", render: () => <StatsScreen /> },
                    ]}
                  />
                ) : section === "balance" ? (
                  <TabbedSection
                    tabs={[
                      { title: "Дневник", render: () => <DiaryScreen navigation={navigation} /> },
                      { title: "Статистика", render: () => <BalanceStatsScreen /> },
                      { title: "Профиль", render: () => <BalanceProfileScreen /> },
                    ]}
                  />
                ) : section === "games" ? (
                  <GamesScreen navigation={navigation} />
                ) : section === "shop" ? (
                  <ShopSection />
                ) : section === "profile" ? (
                  <ProfileSection />
                ) : section === "more" ? (
                  <MoreScreen onOpen={openSection} navigation={navigation} />
                ) : (
                  <UsageScreen navigation={navigation} />
                )}
              </View>
              <SectionBar section={section} onSelect={openSection} />
            </View>
          )}
        </Stack.Screen>
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Настройки" }} />
        <Stack.Screen name="Library" component={LibraryScreen} options={{ title: "Подсказки" }} />
        <Stack.Screen name="Archive" component={ArchiveScreen} options={{ title: "Архив привычек" }} />
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: "Настройки админа" }} />
        <Stack.Screen name="AddFood" component={AddFoodScreen} options={{ title: "Добавить еду" }} />
        <Stack.Screen
          name="AppUsage"
          component={AppUsageScreen}
          options={({ route }) => ({ title: (route.params as { title?: string })?.title ?? "Приложение" })}
        />
        <Stack.Screen name="Phases" component={PhasesScreen} options={{ title: "Этапы" }} />
        <Stack.Screen name="HabitsReport" component={HabitsReportScreen} options={{ title: "По привычкам" }} />
        {/* Titled from the habit's own name, so the header says which one you opened. */}
        <Stack.Screen
          name="HabitReport"
          component={HabitReportScreen}
          options={({ route }) => ({ title: (route.params as { title?: string })?.title ?? "Привычка" })}
        />
        {/* Заголовок называет раздел: экран один на три, и «Уведомления» без имени
            оставляли бы вопрос, чьи именно. */}
        <Stack.Screen
          name="Reminder"
          component={ReminderScreen}
          options={({ route }) => {
            const channel = (route.params as { channel?: ReminderChannel })?.channel ?? "sterzhen";
            return { title: `Уведомления · ${CHANNEL_LABELS[channel]}` };
          }}
        />
        {/* Год с двенадцатью месяцами — одна дверь, за которой и цели, и итоги. */}
        <Stack.Screen name="Goals" component={GoalsScreen} options={{ title: goalsScreenTitle() }} />
        <Stack.Screen name="WordSearch" component={WordSearchScreen} options={{ title: "Найди слова" }} />
        <Stack.Screen name="Wheel" component={WheelScreen} options={{ title: "Колесо букв" }} />
        {/* Заголовок называет месяц: экран открывается с любой клетки года, и «Цель» без
            имени оставляла бы вопрос, чья именно. */}
        <Stack.Screen
          name="Goal"
          component={GoalScreen}
          options={({ route }) => ({ title: goalScreenTitle((route.params as { period: string }).period) })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
