import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { Banner, colors, Icon } from "../components/ui";
import { useHandsFree } from "../hooks/useHandsFree";
import { useQuickTranslate } from "../hooks/useQuickTranslate";
import { MEETING_LANGUAGES } from "../lib/meetings";
import type { QuickResult } from "../types";

type Side = "top" | "bottom";
const other = (s: Side): Side => (s === "top" ? "bottom" : "top");

/**
 * Face-to-face: one phone on the table between two people. The top half is upside down so the
 * person opposite can read it. Hold to talk: each person holds their button. Hands-free: the phone
 * listens, works out who spoke from the language, and speaks the translation to the other person.
 */
export default function FaceToFaceScreen() {
  const [lang, setLang] = useState<Record<Side, string>>({ top: "hi", bottom: "ta" });
  const [last, setLast] = useState<Partial<Record<Side, QuickResult>>>({});
  const [speak, setSpeak] = useState(true);
  const t = useQuickTranslate();
  const [handsFree, setHandsFree] = useState(false);
  const auto = useHandsFree((r) => setLast({ [lang.top === r.source_language ? "top" : "bottom"]: r }));
  const locked = Boolean(t.recording || t.busy || auto.listening);

  async function toggleMode(on: boolean) {
    if (!on) await auto.stop();
    setHandsFree(on);
  }

  async function release(side: Side) {
    const result = await t.stop({ source_language: lang[side], target_language: lang[other(side)], speak });
    if (result) setLast({ [side]: result });
  }

  const half = (side: Side) => {
    const heard = last[other(side)]; // what the other person said, in my language
    const said = last[side];
    const isRec = t.recording === side;
    const isBusy = t.busy === side;
    return (
      <View style={{ flex: 1, padding: 16, gap: 10, transform: side === "top" ? [{ rotate: "180deg" }] : [] }}>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
          {MEETING_LANGUAGES.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => setLang({ ...lang, [side]: l.code })}
              disabled={locked || l.code === lang[other(side)]}
              accessibilityRole="radio"
              accessibilityState={{ selected: lang[side] === l.code }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: lang[side] === l.code ? colors.brand : colors.line,
                backgroundColor: lang[side] === l.code ? colors.brandSoft : "#fff",
              }}
            >
              <Text style={{ fontWeight: "700", color: lang[side] === l.code ? colors.brand : colors.ink }}>{l.native}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1, justifyContent: "center" }}>
          {heard ? (
            <Pressable onPress={() => void t.play(heard)} accessibilityHint="Play again">
              <Text style={{ fontSize: 24, lineHeight: 34, fontWeight: "600", color: colors.ink, textAlign: "center" }}>{heard.translation}</Text>
            </Pressable>
          ) : said ? null : (
            <Text style={{ color: colors.muted, textAlign: "center" }}>{handsFree ? "Just speak — then pause" : "Hold the button and speak"}</Text>
          )}
          {said ? (
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 8 }} numberOfLines={3}>
              You: {said.original}
            </Text>
          ) : null}
        </View>
        {!handsFree && (
        <Pressable
          onPressIn={() => void t.start(side, () => void release(side))}
          onPressOut={() => void release(side)}
          disabled={Boolean((t.recording && !isRec) || t.busy)}
          accessibilityRole="button"
          accessibilityLabel={`Hold to speak ${MEETING_LANGUAGES.find((l) => l.code === lang[side])?.name}`}
          style={{
            height: 72,
            borderRadius: 36,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isRec ? colors.danger : colors.brand,
            opacity: (t.recording && !isRec) || t.busy ? 0.5 : 1,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name={isRec ? "radio-button-on" : "mic"} size={22} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>{isRec ? "Listening… release to translate" : isBusy ? "Translating…" : "Hold to speak"}</Text>
          </View>
        </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {half("top")}
      <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: "#fff", paddingVertical: 6, paddingHorizontal: 12, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <Text style={{ color: colors.muted }}>Speak aloud</Text>
          <Switch value={speak} onValueChange={setSpeak} disabled={auto.listening} trackColor={{ true: colors.brand }} />
          <Text style={{ color: colors.muted }}>Hands-free</Text>
          <Switch value={handsFree} onValueChange={(v) => void toggleMode(v)} disabled={Boolean(t.recording || t.busy)} trackColor={{ true: colors.brand }} />
        </View>
        {handsFree && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Pressable
              onPress={() => void (auto.listening ? auto.stop() : auto.start(`${lang.bottom},${lang.top}`, speak))}
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: auto.listening ? colors.danger : colors.brand }}
            >
              <Icon name={auto.listening ? "stop" : "mic"} size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700" }}>{auto.listening ? "Stop" : "Start listening"}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.subtle, overflow: "hidden" }}>
                <View style={{ height: 6, width: `${Math.max(0, Math.min(100, (auto.level + 60) * 1.7))}%`, backgroundColor: auto.hearing ? colors.danger : colors.accent }} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} accessibilityLiveRegion="polite">
                {!auto.listening ? "One person at a time, pause when done" : auto.busy ? "Translating…" : auto.hearing ? "Hearing someone…" : "Listening…"}
              </Text>
            </View>
          </View>
        )}
      </View>
      {t.error || auto.error ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Banner tone="danger">{t.error || auto.error}</Banner>
        </View>
      ) : null}
      {half("bottom")}
    </View>
  );
}
