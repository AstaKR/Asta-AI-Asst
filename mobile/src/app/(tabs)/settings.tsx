import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";

import { ApiError, api, type LanguageSelection } from "../../api";
import { useAuth } from "../../auth";
import { LanguagePicker } from "../../components/LanguagePicker";
import { PlanCard } from "../../components/PlanCard";
import { Banner, Button, Card, Field, Muted, Screen, colors, styles } from "../../components/ui";
import type { UsageSummary } from "../../types";

const VOLUMES = [0, 15, 30, 60];

function PhoneCard() {
  const { user, refresh } = useAuth();
  const current = user?.phone_number ?? null;
  const [editing, setEditing] = useState(!current);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={styles.label}>Mobile number</Text>
      <Muted style={{ marginBottom: 12 }}>Add your number so people can call you by it. We verify it with an SMS code.</Muted>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {current && !editing ? (
        <>
          <Text style={{ fontSize: 16, fontWeight: "600", marginBottom: 10 }}>{current} · Verified</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label="Change" variant="secondary" onPress={() => setEditing(true)} style={{ flex: 1 }} />
            <Button
              label="Remove"
              variant="secondary"
              disabled={busy}
              style={{ flex: 1 }}
              onPress={() =>
                run(async () => {
                  await api.removePhone();
                  await refresh();
                  setEditing(true);
                }, "Could not remove the number")
              }
            />
          </View>
        </>
      ) : !sentTo ? (
        <>
          <Field label="Mobile number (India, +91)" placeholder="98765 43210" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} maxLength={16} />
          <Button
            label="Send code"
            busy={busy}
            disabled={phone.replace(/\D/g, "").length < 10}
            onPress={() => run(async () => setSentTo((await api.requestPhoneCode(phone)).sent_to), "Could not send the code")}
          />
          {current ? <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={{ marginTop: 10 }} /> : null}
        </>
      ) : (
        <>
          <Muted style={{ marginBottom: 8 }}>Code sent to {sentTo}.</Muted>
          <Field label="6-digit code" keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" value={code} onChangeText={setCode} maxLength={8} />
          <Button
            label="Verify number"
            busy={busy}
            disabled={code.trim().length < 4}
            onPress={() =>
              run(async () => {
                await api.verifyPhone(phone, code.trim());
                await refresh();
                setSentTo("");
                setCode("");
                setPhone("");
                setEditing(false);
              }, "Could not verify the code")
            }
          />
          <Button label="Change number" variant="secondary" onPress={() => setSentTo("")} style={{ marginTop: 10 }} />
        </>
      )}
    </Card>
  );
}

export default function Settings() {
  const { user, refresh, signOut } = useAuth();
  const prefs = user!.preferences;
  const [name, setName] = useState(prefs.display_name);
  const [sel, setSel] = useState<LanguageSelection>({ spoken_language: prefs.spoken_language, listen_language: prefs.listen_language });
  const [volume, setVolume] = useState(prefs.original_voice_volume);
  const [subtitles, setSubtitles] = useState(prefs.show_subtitles);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.usage().then(setUsage).catch(() => undefined);
  }, []);

  async function save() {
    try {
      await api.savePreferences({ display_name: name, ...sel, original_voice_volume: volume, show_subtitles: subtitles });
      await refresh();
      setMsg("Saved");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not save");
    }
  }

  return (
    <Screen>
      <ScrollView>
        <PlanCard />
        <PhoneCard />
        {msg ? <Banner tone="info">{msg}</Banner> : null}
        <Card>
          <Field label="Name shown on calls" value={name} onChangeText={setName} maxLength={60} />
          <LanguagePicker value={sel} onChange={setSel} />
          <Text style={[styles.label, { marginTop: 16 }]}>Other person’s original voice under the translation</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {VOLUMES.map((v) => (
              <Button key={v} label={v === 0 ? "Off" : `${v}%`} variant={v === volume ? "primary" : "secondary"} onPress={() => setVolume(v)} style={{ flex: 1, minHeight: 40 }} />
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
            <Text style={styles.label}>Show live subtitles</Text>
            <Switch value={subtitles} onValueChange={setSubtitles} trackColor={{ true: colors.brand }} />
          </View>
          <Button label="Save" onPress={save} style={{ marginTop: 14 }} />
        </Card>
        {usage && (
          <Card>
            <Text style={styles.label}>Today’s usage (whole service)</Text>
            <Muted>
              Call time {Math.round(usage.today.call_seconds / 60)} / {Math.round(usage.daily_limits.call_seconds / 60)} min{"\n"}
              Speech recognised {Math.round(usage.today.stt_seconds)} / {usage.daily_limits.stt_seconds} s{"\n"}
              Translated {usage.today.translate_chars} / {usage.daily_limits.translate_chars} chars{"\n"}
              Synthesised {usage.today.tts_chars} / {usage.daily_limits.tts_chars} chars
            </Muted>
            <Muted style={{ marginTop: 8 }}>
              Your calls: {usage.mine.calls} · {Math.round(usage.mine.call_seconds / 60)} min
            </Muted>
          </Card>
        )}
        <Button
          label="Sign out"
          variant="secondary"
          onPress={async () => {
            await signOut();
            router.replace("/login");
          }}
        />
        <Muted style={{ marginTop: 14, textAlign: "center" }}>
          AI translations can contain mistakes. Calls are not recorded unless every participant chooses to save the transcript.
        </Muted>
      </ScrollView>
    </Screen>
  );
}
