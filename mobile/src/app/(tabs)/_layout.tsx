import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";

import { colors, fonts, type IconName } from "../../components/ui";

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: "home", title: "Calls", icon: "call-outline", iconActive: "call" },
  { name: "tools", title: "Translate", icon: "language-outline", iconActive: "language" },
  { name: "assistant", title: "Assistant", icon: "sparkles-outline", iconActive: "sparkles" },
  { name: "meetings", title: "Meetings", icon: "document-text-outline", iconActive: "document-text" },
  { name: "settings", title: "Settings", icon: "settings-outline", iconActive: "settings" },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
        tabBarActiveTintColor: colors.chilliText,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.ink, borderTopWidth: 2.5, height: 66, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.sansBold },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.name === "home" ? "Asta Talk" : t.title,
            tabBarLabel: t.title,
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? t.iconActive : t.icon} size={size} color={String(color)} />,
          }}
        />
      ))}
    </Tabs>
  );
}
