/**
 * App.js — root entry point.
 * Sets up the React Navigation stack.
 */
import React, { useEffect } from "react";
import { migrateSavedVideos, resumeInterrupted } from "./src/services/downloadManager";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "./src/theme";

import HomeScreen from "./src/screens/HomeScreen";
import DetailScreen from "./src/screens/DetailScreen";
import PlayerScreen from "./src/screens/PlayerScreen";
import DownloadsScreen from "./src/screens/DownloadsScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => {
    resumeInterrupted().catch(console.warn);
    migrateSavedVideos().catch(console.warn);
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer
          linking={{
            prefixes: ["moviebox://"],
            config: { screens: { Player: "watch", Downloads: "downloads" } },
          }}
        >
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              orientation: "portrait",
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: "#fff",
              headerTitleStyle: { fontWeight: "bold" },
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Detail"
              component={DetailScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Player"
              component={PlayerScreen}
              options={{ headerShown: false, orientation: "landscape" }}
            />
            <Stack.Screen
              name="Downloads"
              component={DownloadsScreen}
              options={{ headerShown: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
