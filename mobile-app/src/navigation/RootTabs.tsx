import { useEffect, useState } from "react";
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BackHandler, Pressable, View } from "react-native";
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
import ReviewScreen from "../screens/ReviewScreen";
import BalanceProfileScreen from "../screens/balance/ProfileScreen";
import DiaryScreen from "../screens/balance/DiaryScreen";
import AddFoodScreen from "../screens/balance/AddFoodScreen";
import BalanceStatsScreen from "../screens/balance/StatsScreen";
import UsageScreen from "../screens/screen/UsageScreen";
import AppUsageScreen from "../screens/screen/AppUsageScreen";
import HomeScreen from "../screens/HomeScreen";
import SectionMenu, { type Section } from "./SectionMenu";
import { CHANNEL_LABELS, type ReminderChannel } from "../notifications/reminders";

// Меню разделов живёт рядом с навигатором, а не внутри экрана, поэтому своего `navigation`
// у него нет: переход в настройки идёт через ссылку на контейнер.
const navRef = createNavigationContainerRef();

/** Насколько глубоко помнится путь по разделам. Дальше — уже не «назад», а история. */
const SECTION_HISTORY = 10;

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.card, border: colors.cardBorder },
};

// No screen declared a tabBarIcon, so React Navigation fell back to its
// built-in placeholder — a "⏷" glyph that the Android system font has no
// character for, which is why the tabs showed empty tofu boxes on a real
// device. Each tab names its own icon now.
type FeatherName = React.ComponentProps<typeof Feather>["name"];

const icon =
  (name: FeatherName) =>
  ({ color, size }: { color: string; size: number }) => <Feather name={name} size={size} color={color} />;

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.cardBorder },
        // Five tabs — ~64px each on a 320px screen. "Статистика" is the longest label the
        // bar has ever carried, so it sets the size rather than the count.
        tabBarLabelStyle: { fontSize: 10 },
        tabBarItemStyle: { paddingHorizontal: 0 },
      }}
    >
      {/* Отчёт first: it opens on the tip of the day, which is the one thing worth seeing
          before you have done anything. Чек-лист sits right next to it since that is what
          the day actually runs on. It used to share the tab with a triggers list on a
          switch; the triggers are gone, so the tab is the checklist and nothing else. */}
      <Tab.Screen name="Отчёт" component={ReportScreen} options={{ tabBarIcon: icon("bar-chart-2") }} />
      <Tab.Screen name="Чек-лист" component={TodayScreen} options={{ tabBarIcon: icon("check-square") }} />
      <Tab.Screen name="Фокус" component={FocusScreen} options={{ tabBarIcon: icon("target") }} />
      <Tab.Screen name="Энергия" component={EnergyScreen} options={{ tabBarIcon: icon("activity") }} />
      {/* Last, and deliberately so: the long view is for looking back, not for the thing you
          open the app to do. */}
      <Tab.Screen name="Статистика" component={StatsScreen} options={{ tabBarIcon: icon("trending-up") }} />
    </Tab.Navigator>
  );
}

/**
 * CaloriX — второй раздел приложения, со своим набором вкладок.
 *
 * Три вкладки в порядке от ежедневного к разовому: дневник открывают каждый день,
 * статистику — раз в неделю посмотреть, куда всё идёт, а профиль настраивают один раз и
 * возвращаются к нему, только когда меняется вес или цель.
 */
function BalanceTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.cardBorder },
        tabBarLabelStyle: { fontSize: 10 },
        tabBarItemStyle: { paddingHorizontal: 0 },
      }}
    >
      {/* Дневник первым: за ним открывают CaloriX каждый день, а профиль настраивают раз. */}
      <Tab.Screen name="Дневник" component={DiaryScreen} options={{ tabBarIcon: icon("book-open") }} />
      <Tab.Screen name="Статистика" component={BalanceStatsScreen} options={{ tabBarIcon: icon("trending-up") }} />
      <Tab.Screen name="Профиль" component={BalanceProfileScreen} options={{ tabBarIcon: icon("user") }} />
    </Tab.Navigator>
  );
}

/**
 * «Экран» — раздел о времени в телефоне.
 *
 * Одна вкладка, и вкладочной панели под ней не будет: навигатор здесь нужен только чтобы
 * раздел вёл себя как остальные два, а второго экрана в нём нет — приложение открывается
 * поверх, из списка.
 */
function ScreenTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" },
      }}
    >
      <Tab.Screen name="Экран" component={UsageScreen} />
    </Tab.Navigator>
  );
}

// A stack around the tabs, so settings and the reference can be pushed on top
// instead of competing for a seventh slot in the bottom bar — seven labels only
// just fit at 320px, and an eighth does not fit at all.
export default function RootTabs() {
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
  const [menuOpen, setMenuOpen] = useState(false);

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
            // No title: every tab already says what it is, and a second title
            // row would just eat height on a 640px screen.
            headerTitle: "",
            headerLeft: () => (
              <Pressable
                onPress={() => setMenuOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Разделы"
                hitSlop={12}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingRight: 4 })}
              >
                <Feather name="menu" size={20} color={colors.textMuted} />
              </Pressable>
            ),
            // Шестерёнка ушла в меню разделов: настройки настраивают все три раздела, и
            // место им там же, где эти разделы выбирают, — а в шапке остаётся то, что
            // относится к текущему экрану.
            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {section === "sterzhen" && <HeaderRefresh />}
              </View>
            ),
          })}
        >
          {() =>
            section === "home" ? (
              <HomeScreen onOpen={openSection} />
            ) : section === "sterzhen" ? (
              <Tabs />
            ) : section === "balance" ? (
              <BalanceTabs />
            ) : (
              <ScreenTabs />
            )
          }
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
        <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Сверка за неделю" }} />
      </Stack.Navigator>

      <SectionMenu
        visible={menuOpen}
        section={section}
        onClose={() => setMenuOpen(false)}
        onSelect={openSection}
        onSettings={() => navRef.current?.navigate("Settings" as never)}
      />
    </NavigationContainer>
  );
}
