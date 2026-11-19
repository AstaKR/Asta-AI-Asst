import { Fraunces_700Bold, Fraunces_900Black } from "@expo-google-fonts/fraunces";
import { InstrumentSans_500Medium, InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

import { AuthProvider } from "../auth";
import { colors, fonts } from "../components/ui";

export default function RootLayout() {
  const [loaded, failed] = useFonts({ Fraunces_700Bold, Fraunces_900Black, InstrumentSans_500Medium, InstrumentSans_700Bold });
  // Hold the first frame until the fonts are ready (they ship inside the app, so this is instant); carry on if they fail.
  if (!loaded && !failed) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Sign in" }} />
        <Stack.Screen name="server" options={{ title: "Server settings" }} />
        <Stack.Screen name="forwarding" options={{ title: "Translate my phone calls" }} />
        <Stack.Screen name="call/[code]" options={{ title: "Call", headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="summary/[code]" options={{ title: "Call summary", headerBackVisible: false }} />
        <Stack.Screen name="translate" options={{ title: "Instant translate" }} />
        <Stack.Screen name="face" options={{ headerShown: false }} />
        <Stack.Screen name="photo" options={{ title: "Photo translate" }} />
        <Stack.Screen name="dial" options={{ title: "Dial" }} />
        <Stack.Screen name="meetings/new" options={{ title: "New meeting" }} />
        <Stack.Screen name="meetings/[id]" options={{ title: "Meeting" }} />
        <Stack.Screen name="meetings/live" options={{ title: "Live meeting", headerBackVisible: false, gestureEnabled: false }} />
      </Stack>
    </AuthProvider>
  );
}
