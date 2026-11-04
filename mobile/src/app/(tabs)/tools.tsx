import { router } from "expo-router";
import { ScrollView, View } from "react-native";

import { Card, ListItem, Muted, SectionHeader, Tile, colors } from "../../components/ui";

/** Translation tools hub. */
export default function ToolsScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <SectionHeader>In person</SectionHeader>
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
        <Tile icon="people" title="Face to face" subtitle="One phone, two people — hold to talk or hands-free" onPress={() => router.push("/face")} />
        <Tile icon="flash" tone="accent" title="Instant" subtitle="Type or speak a phrase" onPress={() => router.push("/translate")} />
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 20 }}>
        <Tile icon="camera" tone="warn" title="Photo" subtitle="Signs, menus, letters, screenshots" onPress={() => router.push("/photo")} />
        <Tile icon="sparkles" tone="muted" title="Assistant" subtitle="Ask how to say anything" onPress={() => router.push("/assistant")} />
      </View>

      <SectionHeader>Phone calls</SectionHeader>
      <Card style={{ paddingVertical: 4 }}>
        <ListItem icon="keypad" title="Dial" subtitle="Call app users free; phone numbers when a line is connected" onPress={() => router.push("/dial")} />
        <ListItem icon="return-down-forward" tone="accent" title="Translate my phone calls" subtitle="Forward calls from your mobile number" onPress={() => router.push("/forwarding")} last />
      </Card>
      <Muted style={{ fontSize: 12, textAlign: "center", marginTop: 4 }}>Tamil · Hindi · English. AI translations can contain mistakes.</Muted>
    </ScrollView>
  );
}
