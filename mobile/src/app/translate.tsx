import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { ApiError, quickApi } from "../api";
import { Banner, Button, Card, Muted, Screen, colors, styles, Icon } from "../components/ui";
import { useQuickTranslate } from "../hooks/useQuickTranslate";
import { MEETING_LANGUAGES, meetingLanguageName } from "../lib/meetings";
import type { QuickResult } from "../types";

const AUTO = { code: "auto", native: "Detect" };

/** Instant translation of typed text or a short spoken phrase. Nothing is saved on the server. */
export default function InstantTranslateScreen() {
  const [source, setSource] = useState("auto");
  const [target, setTarget] = useState("en");
  const [text, setText] = useState("");
  const [speak, setSpeak] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<QuickResult[]>([]);
  const t = useQuickTranslate();

  const add = (r: QuickResult) => setHistory((h) => [r, ...h].slice(0, 20));

  async function translateText() {
    setBusy(true);
    setError("");
    try {
      const r = await quickApi.text({ text: text.trim(), source_language: source, target_language: target, speak });
      add(r);
      if (speak) await t.play(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Translation failed");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    const r = await t.stop({ source_language: source, target_language: target, speak });
    if (r) add(r);
  }

  function swap() {
    if (source === "auto") return;
    setSource(target);
    setTarget(source);
  }

  const chips = (options: { code: string; native: string }[], value: string, onPick: (c: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((l) => (
        <Pressable
          key={l.code}
          onPress={() => onPick(l.code)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === l.code }}
          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: value === l.code ? colors.brand : colors.line, backgroundColor: value === l.code ? colors.brandSoft : "#fff" }}
        >
          <Text style={{ fontWeight: "600", color: value === l.code ? colors.brand : colors.ink }}>{l.native}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const shownError = error || t.error;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
        <Card>
          <Text style={styles.label}>From</Text>
          {chips([AUTO, ...MEETING_LANGUAGES], source, setSource)}
          <Pressable onPress={swap} disabled={source === "auto"} style={{ alignSelf: "center", padding: 6 }} accessibilityLabel="Swap languages">
            <Icon name="swap-vertical" size={22} color={source === "auto" ? colors.line : colors.brand} />
          </Pressable>
          <Text style={styles.label}>To</Text>
          {chips([...MEETING_LANGUAGES], target, setTarget)}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <Text style={{ color: colors.ink }}>Speak the translation</Text>
            <Switch value={speak} onValueChange={setSpeak} trackColor={{ true: colors.brand }} />
          </View>
        </Card>

        {shownError ? <Banner tone="danger">{shownError}</Banner> : null}

        <Card>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type to translate…"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={1000}
            style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
          />
          <Button
            label={source === "auto" ? "Choose the From language to translate text" : "Translate text"}
            onPress={() => void translateText()}
            busy={busy}
            disabled={!text.trim() || source === "auto" || Boolean(t.recording)}
            style={{ marginTop: 10 }}
          />
          <Pressable
            onPressIn={() => void t.start("mic", () => void release())}
            onPressOut={() => void release()}
            disabled={busy || Boolean(t.busy)}
            accessibilityRole="button"
            accessibilityLabel="Hold to speak"
            style={{ marginTop: 10, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: t.recording ? colors.danger : colors.accent, opacity: busy || t.busy ? 0.5 : 1 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name={t.recording ? "radio-button-on" : "mic"} size={21} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>{t.recording ? "Listening… release to translate" : t.busy ? "Translating…" : "Hold to speak"}</Text>
            </View>
          </Pressable>
          <Muted style={{ marginTop: 6, fontSize: 12, textAlign: "center" }}>Up to 30 seconds per phrase. Nothing is saved.</Muted>
        </Card>

        {history.map((r, i) => (
          <Card key={history.length - i}>
            <Muted style={{ fontSize: 12 }}>
              {meetingLanguageName(r.source_language)} → {meetingLanguageName(r.target_language)}
            </Muted>
            <Text style={{ color: colors.muted, marginTop: 4 }}>{r.original}</Text>
            <Text style={{ fontSize: 19, lineHeight: 27, color: colors.ink, fontWeight: "600", marginTop: 6 }} selectable>
              {r.translation}
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              {r.audio ? <Button label="Play" icon="volume-high-outline" variant="secondary" onPress={() => void t.play(r)} style={{ flex: 1, minHeight: 40 }} /> : null}
              <Button label="Copy" icon="copy-outline" variant="secondary" onPress={() => void Clipboard.setStringAsync(r.translation)} style={{ flex: 1, minHeight: 40 }} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
