import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";

import { useAuth } from "../auth";
import { Banner, Button, Card, Field, Muted, Screen, colors, styles } from "../components/ui";
import { DEFAULT_API_URL, checkServer, getApiUrl, isCustomServer, isInsecurePublic, normalizeServerUrl, type ServerCheck } from "../config";

type Busy = "test" | "save" | null;

/** Lets each customer point the same APK at their own server (office Wi-Fi or internet). */
export default function ServerSettings() {
  const { user, changeServer } = useAuth();
  const current = getApiUrl();
  const [address, setAddress] = useState(current);
  const [result, setResult] = useState<(ServerCheck & { url: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

  /** Cleans up the typed address and checks it. Returns the URL when the server answered. */
  async function test(which: Exclude<Busy, null>): Promise<string | null> {
    setError("");
    const parsed = normalizeServerUrl(address);
    if ("error" in parsed) {
      setResult(null);
      setError(parsed.error);
      return null;
    }
    setAddress(parsed.url);
    // Already confirmed a moment ago: don't make the user wait for a second check.
    if (result?.ok && result.url === parsed.url) return parsed.url;
    setResult(null);
    setBusy(which);
    const check = await checkServer(parsed.url);
    setBusy(null);
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

  async function onSave() {
    const url = await test("save");
    if (url) await apply(url);
  }

  const insecure = result?.ok && isInsecurePublic(result.url);
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

          <Card>
            <Field
              label="Server address"
              placeholder="192.168.1.50:8000"
              hint="Office Wi-Fi: the server's IP and port. Internet: its web address, like https://app.yourcompany.com."
              error={error}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setResult(null);
                setError("");
              }}
              onSubmitEditing={() => test("test")}
              returnKeyType="go"
              maxLength={200}
            />
            {result ? <Banner tone={result.ok ? "success" : "danger"}>{result.ok ? `✓ ${result.message}` : result.message}</Banner> : null}
            {insecure ? <Banner tone="warn">This address is not encrypted (http). Your password and calls would travel in the clear. Use https:// for a server on the internet.</Banner> : null}
            <Button label="Test connection" variant="secondary" icon="wifi" onPress={() => test("test")} busy={busy === "test"} disabled={busy !== null} />
            <Button label="Save and use this server" onPress={onSave} busy={busy === "save"} disabled={busy !== null} style={{ marginTop: 10 }} />
            {isCustomServer() ? (
              <Button label="Use the built-in server" variant="secondary" onPress={() => apply(null)} disabled={busy !== null} style={{ marginTop: 10 }} />
            ) : null}
          </Card>

          <Muted>Ask your administrator for the address. The phone must be on the same network as an office server. Accounts belong to a server, so changing it signs you out.</Muted>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
