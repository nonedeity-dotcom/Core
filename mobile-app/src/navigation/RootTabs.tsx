import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, View } from "react-native";
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
import HeaderRefresh from "../components/HeaderRefresh";
import PhasesScreen from "../screens/PhasesScreen";
import HabitReportScreen from "../screens/HabitReportScreen";
import ReviewScreen from "../screens/ReviewScreen";

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

// A stack around the tabs, so settings and the reference can be pushed on top
// instead of competing for a seventh slot in the bottom bar — seven labels only
// just fit at 320px, and an eighth does not fit at all.
export default function RootTabs() {
  return (
    <NavigationContainer theme={navTheme}>
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
          component={Tabs}
          options={({ navigation }) => ({
            // No title: every tab already says what it is, and a second title
            // row would just eat height on a 640px screen.
            headerTitle: "",
            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {/* Only on the tabs, not on the pushed screens: nothing behind the gear
                    reads anything that another app can change under it. */}
                <HeaderRefresh />
                <Pressable
                  onPress={() => navigation.navigate("Settings")}
                  accessibilityRole="button"
                  accessibilityLabel="Настройки"
                  hitSlop={12}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Feather name="settings" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            ),
          })}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Настройки" }} />
        <Stack.Screen name="Library" component={LibraryScreen} options={{ title: "Подсказки" }} />
        <Stack.Screen name="Archive" component={ArchiveScreen} options={{ title: "Архив привычек" }} />
        <Stack.Screen name="Phases" component={PhasesScreen} options={{ title: "Этапы" }} />
        {/* Titled from the habit's own name, so the header says which one you opened. */}
        <Stack.Screen
          name="HabitReport"
          component={HabitReportScreen}
          options={({ route }) => ({ title: (route.params as { title?: string })?.title ?? "Привычка" })}
        />
        <Stack.Screen name="Reminder" component={ReminderScreen} options={{ title: "Уведомления" }} />
        <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Сверка за неделю" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
