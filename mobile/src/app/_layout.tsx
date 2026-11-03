import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "../auth";
import { colors } from "../components/ui";

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: "700" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Sign in" }} />
        <Stack.Screen name="forwarding" options={{ title: "Translate my phone calls" }} />
        <Stack.Screen name="call/[code]" options={{ title: "Call", headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="summary/[code]" options={{ title: "Call summary", headerBackVisible: false }} />
        <Stack.Screen name="translate" options={{ title: "Instant translate" }} />
        <Stack.Screen name="face" options={{ title: "Face to face" }} />
        <Stack.Screen name="photo" options={{ title: "Photo translate" }} />
        <Stack.Screen name="dial" options={{ title: "Call a phone number" }} />
        <Stack.Screen name="meetings/new" options={{ title: "New meeting" }} />
        <Stack.Screen name="meetings/[id]" options={{ title: "Meeting" }} />
        <Stack.Screen name="meetings/live" options={{ title: "Live meeting", headerBackVisible: false, gestureEnabled: false }} />
      </Stack>
    </AuthProvider>
  );
}
