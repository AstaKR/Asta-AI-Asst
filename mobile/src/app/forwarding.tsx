import { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";

import { api, phoneApi } from "../api";
import { Banner, Button, Card, Muted, Screen, styles } from "../components/ui";

/**
 * Standard GSM call-forwarding (MMI) codes. They are handled by the user's mobile operator, not by this
 * app; most Indian operators support them, some plans charge forwarded minutes as outgoing calls.
 */
const MODES = [
  { key: "all", title: "Forward all calls", on: (n: string) => `**21*${n}#`, off: "##21#", note: "Every call is translated. No call reaches your phone directly." },
  { key: "busy", title: "Only when busy", on: (n: string) => `**67*${n}#`, off: "##67#", note: "Calls you reject or miss while on another call go to the translator." },
  { key: "noanswer", title: "Only when unanswered", on: (n: string) => `**61*${n}#`, off: "##61#", note: "Calls you don't pick up go to the translator." },
] as const;

function dial(code: string) {
  // '#' must be URL-encoded or the Android dialer drops everything after it.
  return Linking.openURL(`tel:${code.replace(/#/g, "%23")}`);
}

export default function Forwarding() {
  const [number, setNumber] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // A dedicated line for this user (forward to it) takes priority over the shared forwarding number.
    Promise.all([api.config(), phoneApi.config().catch(() => null)])
      .then(([c, phone]) => setNumber(phone?.my_lines[0] ?? c.phone_forwarding_number))
      .catch(() => setNumber(null));
  }, []);

  return (
    <Screen>
      <ScrollView>
        <Muted style={{ marginBottom: 12 }}>
          People keep calling your normal mobile number. Your operator forwards the call to the translator line, the caller hears
          your words in their language, and you take the call in this app.
        </Muted>
        {number === null && (
          <Banner tone="warn">
            The translator phone line is not set up on this server yet. This option becomes available once the telephony provider
            is connected.
          </Banner>
        )}
        {number ? (
          <Card>
            <Text style={styles.label}>Translator line</Text>
            <Text style={{ fontSize: 20, fontWeight: "700", letterSpacing: 1 }}>{number}</Text>
          </Card>
        ) : null}
        {MODES.map((mode) => (
          <Card key={mode.key}>
            <Text style={styles.label}>{mode.title}</Text>
            <Muted style={{ marginBottom: 10 }}>{mode.note}</Muted>
            <Muted style={{ marginBottom: 10 }}>
              On: {number ? mode.on(number) : mode.on("<number>")} · Off: {mode.off}
            </Muted>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button label="Turn on" disabled={!number || Platform.OS === "ios"} onPress={() => number && dial(mode.on(number))} style={{ flex: 1 }} />
              <Button label="Turn off" variant="secondary" disabled={Platform.OS === "ios"} onPress={() => dial(mode.off)} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}
        {Platform.OS === "ios" && (
          <Banner tone="info">On iPhone, apps cannot dial forwarding codes. Use Settings → Phone → Call Forwarding, or type the code in the Phone app.</Banner>
        )}
        <Muted style={{ marginTop: 6 }}>
          The dialer opens with the code filled in; press call to confirm. Your operator may charge forwarded minutes depending on your plan.
        </Muted>
      </ScrollView>
    </Screen>
  );
}
