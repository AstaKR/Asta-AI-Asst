import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, Vibration, View } from "react-native";

import { ApiError, directApi, phoneApi } from "../api";
import { useAuth } from "../auth";
import { NATIVE_NAMES } from "../lib/languages";
import type { DirectCall, PhoneCall } from "../types";
import { Banner, Button, Card, Muted, colors, styles, Icon } from "./ui";

const POLL_MS = 3000;

type Ringing = { kind: "phone"; call: PhoneCall } | { kind: "app"; call: DirectCall };

/**
 * Ringing incoming calls: app-to-app calls from other users, and (when telephony is on) normal phone
 * calls bridged by LiveKit SIP. Polls while the screen is focused; ringing in the background needs
 * push notifications, which are a later step.
 */
export function IncomingCalls({ phoneEnabled }: { phoneEnabled: boolean }) {
  const { user } = useAuth();
  const [ringing, setRinging] = useState<Ringing[]>([]);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let wasRinging = false;
      const tick = async () => {
        const [app, phone] = await Promise.all([
          directApi.incoming().catch(() => [] as DirectCall[]),
          phoneEnabled ? phoneApi.incoming().catch(() => [] as PhoneCall[]) : Promise.resolve([] as PhoneCall[]),
        ]);
        if (!alive) return;
        const next: Ringing[] = [...app.map((call) => ({ kind: "app" as const, call })), ...phone.map((call) => ({ kind: "phone" as const, call }))];
        if (next.length && !wasRinging) Vibration.vibrate([0, 400, 300, 400]);
        wasRinging = next.length > 0;
        setRinging(next);
      };
      void tick();
      const id = setInterval(() => void tick(), POLL_MS);
      return () => {
        alive = false;
        clearInterval(id);
        Vibration.cancel();
      };
    }, [phoneEnabled]),
  );

  async function answer(r: Ringing) {
    setError("");
    try {
      if (r.kind === "app") {
        await directApi.answer(r.call.id, { spoken_language: user?.preferences.spoken_language, listen_language: user?.preferences.listen_language });
      } else {
        await phoneApi.answer(r.call.id);
      }
      setRinging((list) => list.filter((x) => x.call.id !== r.call.id));
      router.push(`/call/${r.call.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not answer");
    }
  }

  async function decline(r: Ringing) {
    setRinging((list) => list.filter((x) => x.call.id !== r.call.id));
    await (r.kind === "app" ? directApi.decline(r.call.id) : phoneApi.decline(r.call.id)).catch(() => undefined);
  }

  if (!ringing.length && !error) return null;
  return (
    <View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {ringing.map((r) => (
        <Card key={r.call.id} style={{ backgroundColor: colors.accentSoft, borderColor: "#a7f3d0" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name={r.kind === "app" && r.call.video ? "videocam" : "call"} size={18} color={colors.accent} />
            <Text style={[styles.label, { color: colors.accent, marginBottom: 0 }]}>
              Incoming {r.kind === "app" && r.call.video ? "video " : ""}call
            </Text>
          </View>
          {r.kind === "app" ? (
            <>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{r.call.other_name}</Text>
              <Muted>
                @{r.call.other_username}
                {r.call.other_language ? ` · speaks ${NATIVE_NAMES[r.call.other_language] ?? r.call.other_language}` : ""} · translated by AI
              </Muted>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{r.call.remote_number || "Unknown number"}</Text>
              <Muted>{r.call.line_number ? `To ${r.call.line_number} · ` : ""}translated by AI when you answer</Muted>
            </>
          )}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Button label="Decline" icon="close" variant="danger" onPress={() => void decline(r)} style={{ flex: 1 }} />
            <Button label="Answer" icon="call" onPress={() => void answer(r)} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </View>
  );
}
