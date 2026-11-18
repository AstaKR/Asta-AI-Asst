import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";

import { useAuth } from "../auth";
import { Banner, Button, Card, Field, Muted, Screen, colors, styles } from "../components/ui";
import { DEFAULT_API_URL, checkServer, getApiUrl, isCustomServer, normalizeServerUrl, type ServerCheck } from "../config";

/** Lets each customer point the same APK at their own server (office Wi-Fi or internet). */
export default function ServerSettings() {
  const { user, changeServer } = useAuth();
  const current = getApiUrl();
  const [address, setAddress] = useState(current);
  const [result, setResult] = useState<(ServerCheck & { url: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  async function test(): Promise<string | null> {
    setError("");
    setResult(null);
    const parsed = normalizeServerUrl(address);
    if ("error" in parsed) {
      setError(parsed.error);
      return null;
    }
    setAddress(parsed.url);
    const check = await checkServer(parsed.url);
    setResult({ ...check, url: parsed.url });
    return check.ok ? parsed.url : null;
  }

  async function apply(url: string | null) {
    const target = url ?? DEFAULT_API_URL;
    if (target === current) {
      router.back();
      return;
    }
    const go = async () => {
      setBusy("save");
      await changeServer(url);
      setBusy(null);
      router.replace("/login");
    };
    if (!user) return go();
    Alert.alert("Change server?", "You'll be signed out. Sign in again with your account on the new server.", [
      { text: "Cancel", style: "cancel" },
      { text: "Change", style: "destructive", onPress: go },
    ]);
  }

  async function onTest() {
    setBusy("test");
    await test();
    setBusy(null);
  }

  async function onSave() {
    setBusy("test");
    const url = await test();
    setBusy(null);
    if (url) await apply(url);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={styles.label}>Connected to</Text>
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "600", marginBottom: 4 }} selectable>
              {current}
            </Text>
            <Muted>{isCustomServer() ? "Your own server" : "Built-in server"}</Muted>
          </Card>

          {error ? <Banner tone="danger">{error}</Banner> : null}
          {result ? <Banner tone={result.ok ? "info" : "danger"}>{result.ok ? `✓ ${result.message}` : result.message}</Banner> : null}

          <Card>
            <Field
              label="Server address"
              placeholder="192.168.1.50:8000 or https://app.yourcompany.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setResult(null);
                setError("");
              }}
              onSubmitEditing={onTest}
              returnKeyType="go"
              maxLength={200}
            />
            <Button label="Test connection" variant="secondary" icon="wifi" onPress={onTest} busy={busy === "test"} disabled={!!busy} />
            <Button label="Save and use this server" onPress={onSave} busy={busy === "save"} disabled={!!busy} style={{ marginTop: 10 }} />
            {isCustomServer() ? (
              <Button label="Use the built-in server" variant="secondary" onPress={() => apply(null)} disabled={!!busy} style={{ marginTop: 10 }} />
            ) : null}
          </Card>

          <Muted style={{ marginTop: 4 }}>
            Ask your administrator for the address.{"\n"}• Office Wi-Fi server: its IP and port, e.g. 192.168.1.50:8000 (phone on the same Wi-Fi).
            {"\n"}• Internet server: its web address, e.g. https://app.yourcompany.com.{"\n"}Accounts belong to a server, so changing it signs you out.
          </Muted>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
