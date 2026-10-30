import { NavigationContainer, getFocusedRouteNameFromRoute, type LinkingOptions } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "./src/auth";
import { LocationPrivacyModal } from "./src/locationConsent";
import { ToastProvider } from "./src/components/Toast";
import type { ExploreStackParamList, RootTabParamList } from "./src/navigation/types";
import { AccountScreen } from "./src/screens/AccountScreen";
import { DetailScreen } from "./src/screens/DetailScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ListScreen } from "./src/screens/ListScreen";
import { RadarScreen } from "./src/screens/RadarScreen";
import { TripsScreen } from "./src/screens/TripsScreen";
import { WishlistScreen } from "./src/screens/WishlistScreen";
import { theme } from "./src/theme";
import { useTranslation } from "react-i18next";

const Stack = createNativeStackNavigator<ExploreStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

const linking: LinkingOptions<RootTabParamList> = {
  prefixes: ["mysterygetaway://"],
  config: {
    screens: {
      Explore: {
        screens: {
          Detail: "spot/:spotId",
        },
      },
      Trips: "trip/:importToken?",
    },
  },
};

function ExploreStack() {
  const { t } = useTranslation();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.ink,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="List" component={ListScreen} options={{ title: t("nav.list") }} />
      <Stack.Screen name="Detail" component={DetailScreen} options={{ title: t("nav.detail") }} />
      <Stack.Screen name="Radar" component={RadarScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

export default function App() {
  const { t } = useTranslation();
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <AuthProvider>
        <NavigationContainer linking={linking}>
          <StatusBar style="dark" />
          <Tab.Navigator
            screenOptions={{
              headerShown: false,
              tabBarIcon: () => null,
              tabBarActiveTintColor: theme.accent,
              tabBarInactiveTintColor: theme.muted,
              tabBarStyle: {
                backgroundColor: theme.card,
                borderTopColor: theme.line,
              },
            }}
          >
            <Tab.Screen
              name="Explore"
              component={ExploreStack}
              options={({ route }) => {
                const focused = getFocusedRouteNameFromRoute(route) ?? "Home";
                const immersive = focused === "Detail" || focused === "Radar";
                return {
                  title: t("nav.explore"),
                  tabBarStyle: immersive
                    ? { display: "none" }
                    : { backgroundColor: theme.card, borderTopColor: theme.line },
                };
              }}
            />
            <Tab.Screen name="Trips" component={TripsScreen} options={{ title: t("nav.trips") }} />
            <Tab.Screen name="Wishlist" component={WishlistScreen} options={{ title: t("nav.wishlist") }} />
            <Tab.Screen name="Account" component={AccountScreen} options={{ title: t("nav.account") }} />
          </Tab.Navigator>
        </NavigationContainer>
        <LocationPrivacyModal />
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
