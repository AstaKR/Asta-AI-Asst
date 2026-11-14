import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { quickSpeakApi } from "../api";
import { Banner, colors, Icon } from "../components/ui";
import { useHandsFree } from "../hooks/useHandsFree";
import { useQuickTranslate } from "../hooks/useQuickTranslate";
import { MEETING_LANGUAGES } from "../lib/meetings";
import type { QuickResult } from "../types";

type Side = "top" | "bottom";
const other = (s: Side): Side => (s === "top" ? "bottom" : "top");
const ACCENT: Record<Side, string> = { top: colors.brand, bottom: colors.accent };

/** Expanding ring behind the mic while someone is speaking. */
function Pulse({ on, color }: { on: boolean; color: string }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!on) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [on, v]);
  if (!on) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 96,
        height: 96,
        borderRadius: 48,
        borderWidth: 2,
        borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
      }}
    />
  );
}

/**
 * Face-to-face conversation: one phone on the table between two people. The top half is upside down so the
 * person opposite can read it. Each panel shows the latest sentence in its own language: what that person said,
 * or the translation of what the other person said (tap the speaker to hear it again). Tap the mic to speak and
 * tap again to send, or switch on hands-free and the phone works out who spoke from the language.
 */
export default function FaceToFaceScreen() {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState<Record<Side, string>>({ top: "hi", bottom: "ta" });
  const [last, setLast] = useState<{ speaker: Side; result: QuickResult } | null>(null);
  const [speak, setSpeak] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const [picking, setPicking] = useState<Side | null>(null);
  const t = useQuickTranslate();
  const auto = useHandsFree((r) => setLast({ speaker: lang.top === r.source_language ? "top" : "bottom", result: r }));
  const locked = Boolean(t.recording || t.busy || auto.listening);

  async function toggleHandsFree(on: boolean) {
    if (!on) await auto.stop();
    setHandsFree(on);
  }

  async function finish(side: Side) {
    const result = await t.stop({ source_language: lang[side], target_language: lang[other(side)], speak });
    if (result) setLast({ speaker: side, result });
  }

  function replay(r: QuickResult) {
    quickSpeakApi
      .speak({ text: r.translation, language: r.target_language })
      .then((v) => t.play({ ...r, ...v }))
      .catch(() => undefined);
  }

  function exit() {
    void auto.stop();
    router.back();
  }

  const panel = (side: Side) => {
    const accent = ACCENT[side];
    const mine = last?.speaker === side;
    const text = last ? (mine ? last.result.original : last.result.translation) : "";
    const isRec = t.recording === side;
    const isBusy = t.busy === side;
    const langName = MEETING_LANGUAGES.find((l) => l.code === lang[side]);
    const micDisabled = Boolean((t.recording && !isRec) || t.busy);
    const hint = isRec ? "Listening… tap to send" : isBusy ? "Translating…" : handsFree ? "Just speak, then pause" : "Tap on the mic to speak";

    return (
      <View
        style={{
          flex: 1,
          marginHorizontal: 12,
          marginVertical: 6,
          borderRadius: 24,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          overflow: "hidden",
          transform: side === "top" ? [{ rotate: "180deg" }] : [],
        }}
      >
        <View style={{ height: 4, backgroundColor: accent }} />
        <View style={{ flex: 1, padding: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
            {picking === side ? (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", flex: 1 }}>
                {MEETING_LANGUAGES.map((l) => {
                  const taken = l.code === lang[other(side)];
                  return (
                    <Pressable
                      key={l.code}
                      disabled={taken}
                      onPress={() => {
                        setLang({ ...lang, [side]: l.code });
                        setPicking(null);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: lang[side] === l.code, disabled: taken }}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: lang[side] === l.code ? accent : colors.line,
                        backgroundColor: lang[side] === l.code ? colors.subtle : "transparent",
                        opacity: taken ? 0.35 : 1,
                      }}
                    >
                      <Text style={{ fontWeight: "700", color: lang[side] === l.code ? accent : colors.ink }}>{l.native}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Pressable
                onPress={() => setPicking(side)}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={`Language: ${langName?.name}. Tap to change`}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: locked ? 0.5 : 1 }}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} />
                <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{langName?.native}</Text>
                <Icon name="chevron-down" size={16} color={colors.muted} />
              </Pressable>
            )}
            {last && !mine && picking !== side ? (
              <Pressable onPress={() => replay(last.result)} accessibilityRole="button" accessibilityLabel="Play translation again" hitSlop={10}>
                <Icon name="volume-high" size={24} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>

          <View style={{ flex: 1, justifyContent: "center" }}>
            {text ? (
              <Text
                style={{ fontSize: text.length > 90 ? 22 : 28, lineHeight: text.length > 90 ? 32 : 40, fontWeight: "600", color: mine ? accent : colors.ink }}
                accessibilityLiveRegion="polite"
              >
                {text}
              </Text>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 16 }}>{handsFree ? "Just speak — then pause." : "Tap the mic and speak."}</Text>
            )}
          </View>

          <View style={{ alignItems: "center", gap: 12 }}>
            {handsFree ? null : (
              <View style={{ alignItems: "center", justifyContent: "center", height: 100 }}>
                <Pulse on={isRec} color={colors.danger} />
                <Pressable
                  onPress={() => (isRec ? void finish(side) : void t.start(side, () => void finish(side)))}
                  disabled={micDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={isRec ? "Stop and translate" : `Tap to speak ${langName?.name}`}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isRec ? colors.danger : colors.canvas,
                    borderWidth: 3,
                    borderColor: isRec ? colors.danger : accent,
                    opacity: micDisabled ? 0.45 : 1,
                  }}
                >
                  <Icon name={isRec ? "stop" : "mic"} size={34} color={isRec ? "#fff" : accent} />
                </Pressable>
              </View>
            )}
            <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.subtle, borderWidth: 1, borderColor: colors.line }}>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{hint}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const pill = (label: string, on: boolean, icon: "volume-high" | "radio", onPress: () => void, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? colors.brand : colors.line,
        backgroundColor: on ? colors.brandSoft : "transparent",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={15} color={on ? colors.brand : colors.muted} />
      <Text style={{ color: on ? colors.ink : colors.muted, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {panel("top")}
      <View style={{ paddingVertical: 4, paddingHorizontal: 12, gap: 8, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Pressable onPress={exit} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 8 }}>
            <Icon name="exit-outline" size={20} color={colors.ink} />
            <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 15 }}>Exit Conversation</Text>
          </Pressable>
          {pill("Speak aloud", speak, "volume-high", () => setSpeak(!speak), auto.listening)}
          {pill("Hands-free", handsFree, "radio", () => void toggleHandsFree(!handsFree), Boolean(t.recording || t.busy))}
        </View>
        {handsFree ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch" }}>
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
        ) : null}
        {t.error || auto.error ? <Banner tone="danger">{t.error || auto.error}</Banner> : null}
      </View>
      {panel("bottom")}
    </View>
  );
}
