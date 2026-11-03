import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ApiError, api, phoneApi } from "../api";
import { useAuth } from "../auth";
import { Banner, Button, Card, Muted, Screen, colors, styles, Icon } from "../components/ui";
import { NATIVE_NAMES } from "../lib/languages";
import type { PhoneCall, PhoneConfig } from "../types";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"];
const CALLER_LANGUAGES = ["", "ta-IN", "hi-IN", "en-IN"]; // "" = detect from their speech
const STATUS: Record<PhoneCall["status"], string> = {
  ringing: "Ringing",
  answered: "In call",
  missed: "Missed",
  declined: "Declined",
  failed: "Failed",
  ended: "Ended",
};

/** Dial a normal phone number; the call is bridged into a translated call room (LiveKit SIP). */
export default function DialScreen() {
  const { user } = useAuth();
  const prefs = user?.preferences;
  const [number, setNumber] = useState("");
  const [callerLanguage, setCallerLanguage] = useState("");
  const [config, setConfig] = useState<PhoneConfig | null>(null);
  const [history, setHistory] = useState<PhoneCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      phoneApi.config().then(setConfig).catch(() => setError("Could not reach the server."));
      phoneApi.calls().then(setHistory).catch(() => undefined);
    }, []),
  );

  function press(key: string) {
    if (key === "⌫") return setNumber((n) => n.slice(0, -1));
    if (key === "+" && number) return;
    setNumber((n) => (n.length < 16 ? n + key : n));
  }

  async function call(target = number) {
    setBusy(true);
    setError("");
    try {
      const spoken = prefs?.spoken_language ?? "ta-IN";
      const listen = prefs?.listen_language ?? spoken;
      const res = await phoneApi.dial({ number: target, spoken_language: spoken, listen_language: listen, caller_language: callerLanguage });
      void api.savePreferences({ spoken_language: spoken, listen_language: listen });
      router.push(`/call/${res.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the call");
    } finally {
      setBusy(false);
    }
  }

  const ready = config?.dial_enabled ?? false;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
        {config && !ready && (
          <Banner tone="warn">
            Phone calling is not set up yet. It needs a phone line from Exotel or Plivo connected to the server (see docs/TELEPHONY.md).
          </Banner>
        )}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card>
          <Text style={{ fontSize: 30, fontWeight: "700", textAlign: "center", letterSpacing: 2, minHeight: 40, color: colors.ink }} accessibilityLabel="Number">
            {number || " "}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10, marginTop: 10 }}>
            {KEYS.map((k) => (
              <Pressable
                key={k}
                onPress={() => press(k)}
                onLongPress={() => k === "⌫" && setNumber("")}
                accessibilityLabel={k === "⌫" ? "Delete" : k}
                style={{ width: "31%", height: 58, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.subtle }}
              >
                {k === "⌫" ? <Icon name="backspace-outline" size={24} /> : <Text style={{ fontSize: 24, fontWeight: "600", color: colors.ink }}>{k}</Text>}
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>They speak</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CALLER_LANGUAGES.map((l) => (
              <Pressable
                key={l || "auto"}
                onPress={() => setCallerLanguage(l)}
                accessibilityRole="radio"
                accessibilityState={{ selected: callerLanguage === l }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: callerLanguage === l ? colors.brand : colors.line, backgroundColor: callerLanguage === l ? colors.brandSoft : "#fff" }}
              >
                <Text style={{ fontWeight: "600", color: callerLanguage === l ? colors.brand : colors.ink }}>{l ? NATIVE_NAMES[l] : "Detect"}</Text>
              </Pressable>
            ))}
          </View>
          <Muted style={{ marginTop: 6, fontSize: 12 }}>
            You speak {NATIVE_NAMES[prefs?.spoken_language ?? "ta-IN"]} (change on Home). They hear a short notice that the call is translated by AI.
          </Muted>

          <Button label="Call" icon="call" onPress={() => void call()} busy={busy} disabled={!ready || number.replace(/\D/g, "").length < 10} style={{ marginTop: 14 }} />
          {config?.allowed_prefixes.length ? <Muted style={{ marginTop: 6, fontSize: 12, textAlign: "center" }}>Indian numbers only ({config.allowed_prefixes.join(", ")}).</Muted> : null}
        </Card>

        {history.length > 0 && (
          <Card>
            <Text style={styles.label}>Recent phone calls</Text>
            {history.slice(0, 15).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => (c.direction === "outbound" || c.remote_number ? setNumber(c.remote_number) : undefined)}
                style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderTopWidth: 1, borderColor: colors.line }}
              >
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Icon name={c.direction === "inbound" ? "arrow-down-outline" : "arrow-up-outline"} size={15} color={c.status === "missed" ? colors.danger : colors.muted} />
                    <Text style={{ color: c.status === "missed" ? colors.danger : colors.ink, fontWeight: "600" }}>{c.remote_number || "Unknown number"}</Text>
                  </View>
                  <Muted style={{ fontSize: 12 }}>{new Date(c.created_at).toLocaleString()}</Muted>
                </View>
                <Muted>{STATUS[c.status]}</Muted>
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
