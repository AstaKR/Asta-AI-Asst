import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ApiError, api, phoneApi, type LanguageSelection } from "../../api";
import { useAuth } from "../../auth";
import { IncomingCalls } from "../../components/IncomingCalls";
import { LanguagePicker } from "../../components/LanguagePicker";
import { Banner, Button, Card, Field, ListItem, Muted, Screen, SectionHeader, colors } from "../../components/ui";
import { languageName } from "../../lib/languages";
import type { Room } from "../../types";

export default function Home() {
  const { user } = useAuth();
  const prefs = user?.preferences;
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs?.spoken_language ?? "ta-IN",
    listen_language: prefs?.listen_language ?? "ta-IN",
    voice: prefs?.voice ?? "",
  });
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phoneEnabled, setPhoneEnabled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      api.rooms().then(setRooms).catch(() => undefined);
      phoneApi.config().then((c) => setPhoneEnabled(c.enabled)).catch(() => undefined);
    }, []),
  );

  if (!user) return <Redirect href="/login" />;

  async function start(video = false) {
    setBusy(true);
    setError("");
    try {
      const room = await api.createRoom(sel, video);
      void api.savePreferences({ spoken_language: sel.spoken_language, listen_language: sel.listen_language });
      router.push(`/call/${room.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the call");
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!clean) return;
    setBusy(true);
    setError("");
    try {
      await api.joinRoom(clean, sel);
      router.push(`/call/${clean}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the call");
    } finally {
      setBusy(false);
    }
  }

  const name = user.preferences.display_name || user.phone_number || "";
  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.ink }}>Hello{name ? `, ${name.split(" ")[0]}` : ""}</Text>
        <Muted style={{ marginBottom: 16 }}>Talk to anyone in Tamil, Hindi or English — translated live.</Muted>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <IncomingCalls phoneEnabled={phoneEnabled} />

        <Card>
          <LanguagePicker value={sel} onChange={setSel} />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Button label="Voice call" icon="call" onPress={() => void start()} busy={busy} style={{ flex: 1 }} />
            <Button label="Video call" icon="videocam" variant="secondary" onPress={() => void start(true)} disabled={busy} style={{ flex: 1 }} />
          </View>
        </Card>

        <Card>
          <Field
            label="Join with an invite code"
            placeholder="ABCD2345"
            autoCapitalize="characters"
            value={code}
            onChangeText={setCode}
            maxLength={12}
            style={{ letterSpacing: 3, fontWeight: "600" }}
          />
          <Button label="Join call" icon="enter-outline" variant="secondary" onPress={join} disabled={!code.trim() || busy} />
        </Card>

        <Card style={{ paddingVertical: 4 }}>
          <ListItem icon="keypad" title="Dial" subtitle="Call someone by username or mobile number" onPress={() => router.push("/dial")} last />
        </Card>

        {rooms.length > 0 && (
          <>
            <SectionHeader>Recent calls</SectionHeader>
            <Card style={{ paddingVertical: 4 }}>
              {rooms.slice(0, 8).map((room, i, list) => {
                const other = room.participants.find((p) => !p.is_you);
                const ended = room.status === "ended";
                return (
                  <ListItem
                    key={room.code}
                    icon={room.phone ? "call" : room.video_enabled ? "videocam" : "person"}
                    tone={ended ? "muted" : "accent"}
                    title={room.phone?.remote_number || (other ? other.display_name : "Waiting for someone")}
                    subtitle={`${new Date(room.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${room.participants
                      .map((p) => languageName(p.spoken_language))
                      .join(" ↔ ")}`}
                    trailing={ended ? "Summary" : "Rejoin"}
                    onPress={() => router.push(ended ? `/summary/${room.code}` : `/call/${room.code}`)}
                    last={i === list.length - 1}
                  />
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
