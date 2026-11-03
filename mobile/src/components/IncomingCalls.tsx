import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { ApiError, phoneApi } from "../api";
import type { PhoneCall } from "../types";
import { Banner, Button, Card, Muted, colors, styles, Icon } from "./ui";

const POLL_MS = 3000;

/**
 * Ringing incoming phone calls (forwarded calls bridged by LiveKit SIP). Polls while the screen is
 * focused; ringing in the background needs push notifications, which are a later step.
 */
export function IncomingCalls({ enabled }: { enabled: boolean }) {
  const [ringing, setRinging] = useState<PhoneCall[]>([]);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let alive = true;
      const tick = () =>
        phoneApi
          .incoming()
          .then((r) => alive && setRinging(r))
          .catch(() => undefined);
      void tick();
      const id = setInterval(tick, POLL_MS);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, [enabled]),
  );

  async function answer(call: PhoneCall) {
    setError("");
    try {
      await phoneApi.answer(call.id);
      setRinging((r) => r.filter((c) => c.id !== call.id));
      router.push(`/call/${call.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not answer");
    }
  }

  async function decline(call: PhoneCall) {
    setRinging((r) => r.filter((c) => c.id !== call.id));
    await phoneApi.decline(call.id).catch(() => undefined);
  }

  if (!ringing.length && !error) return null;
  return (
    <View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {ringing.map((c) => (
        <Card key={c.id} style={{ backgroundColor: colors.accentSoft, borderColor: "#a7f3d0" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name="call" size={18} color={colors.accent} />
            <Text style={[styles.label, { color: colors.accent, marginBottom: 0 }]}>Incoming call</Text>
          </View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{c.remote_number || "Unknown number"}</Text>
          <Muted>{c.line_number ? `To ${c.line_number} · ` : ""}translated by AI when you answer</Muted>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Button label="Decline" icon="close" variant="danger" onPress={() => void decline(c)} style={{ flex: 1 }} />
            <Button label="Answer" icon="call" onPress={() => void answer(c)} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </View>
  );
}
