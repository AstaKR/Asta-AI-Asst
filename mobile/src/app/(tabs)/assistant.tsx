import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ApiError, assistantApi, quickApi } from "../../api";
import { Banner, Muted, colors, styles, Icon } from "../../components/ui";
import { useQuickTranslate } from "../../hooks/useQuickTranslate";
import { MEETING_LANGUAGES } from "../../lib/meetings";
import type { AssistantConfig, ChatMessage } from "../../types";

const SUGGESTIONS = [
  "How do I say “Where is the hospital?” in Hindi?",
  "Write a polite Tamil message saying I will be 10 minutes late",
  "What is the difference between நன்றி and ரொம்ப நன்றி?",
  "How do I translate a phone call with this app?",
];
// Keep requests small: the server accepts up to 20 messages; older turns are dropped first.
const MAX_HISTORY = 19;
const MAX_SPEAK_CHARS = 1000;

/** AI language assistant (Claude, or a local model on the server). The conversation stays on the phone; the server does not store it. */
export default function AssistantScreen() {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [language, setLanguage] = useState("en");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [error, setError] = useState("");
  const list = useRef<FlatList<ChatMessage>>(null);
  const mic = useQuickTranslate();

  useEffect(() => {
    assistantApi.config().then(setConfig).catch(() => setError("Could not reach the server."));
  }, []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setSending(true);
    setError("");
    try {
      // The history sent must start with a user turn.
      let history = next.slice(-MAX_HISTORY);
      while (history[0]?.role !== "user") history = history.slice(1);
      const { reply } = await assistantApi.chat(history, language);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages(messages); // take the unanswered question back out so it can be retried
      setDraft(content);
      setError(err instanceof ApiError ? err.message : "The assistant could not answer.");
    } finally {
      setSending(false);
    }
  }

  async function speak(index: number) {
    setSpeaking(index);
    setError("");
    try {
      const text = messages[index].content.slice(0, MAX_SPEAK_CHARS);
      // Same source and target language: the server only synthesizes speech.
      const result = await quickApi.text({ text, source_language: language, target_language: language, speak: true });
      await mic.play(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not play the answer.");
    } finally {
      setSpeaking(null);
    }
  }

  async function releaseMic() {
    const result = await mic.stop({ source_language: "auto", target_language: language, speak: false, transcribe_only: true });
    if (result) setDraft((d) => (d ? `${d} ${result.original}` : result.original));
  }

  const disabled = config !== null && !config.enabled;
  const shownError = error || mic.error;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Muted>Answer in</Muted>
          {MEETING_LANGUAGES.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => setLanguage(l.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected: language === l.code }}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: language === l.code ? colors.brand : colors.line, backgroundColor: language === l.code ? colors.brandSoft : "#fff" }}
            >
              <Text style={{ fontWeight: "600", color: language === l.code ? colors.brand : colors.ink }}>{l.native}</Text>
            </Pressable>
          ))}
        </View>
        {disabled && <Banner tone="warn">The assistant is not configured on the server yet (ANTHROPIC_API_KEY).</Banner>}
        {shownError ? <Banner tone="danger">{shownError}</Banner> : null}
      </View>

      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <ScrollView contentContainerStyle={{ gap: 8 }}>
            <Muted>Ask about words, phrases, polite replies or how to use the app. Try:</Muted>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} onPress={() => void send(s)} disabled={disabled} style={[styles.card, { padding: 12 }]}>
                <Text style={{ color: colors.ink }}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        }
        ListFooterComponent={sending ? <Muted style={{ marginTop: 4 }}>Thinking…</Muted> : undefined}
        renderItem={({ item, index }) => {
          const mine = item.role === "user";
          return (
            <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%" }}>
              <View style={{ backgroundColor: mine ? colors.brand : "#fff", borderRadius: 16, padding: 12, borderWidth: mine ? 0 : 1, borderColor: colors.line }}>
                <Text style={{ color: mine ? "#fff" : colors.ink, fontSize: 16, lineHeight: 23 }} selectable>
                  {item.content}
                </Text>
              </View>
              {!mine && (
                <View style={{ flexDirection: "row", gap: 14, marginTop: 4, paddingLeft: 6 }}>
                  <Pressable onPress={() => void speak(index)} disabled={speaking !== null}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name="volume-high-outline" size={16} color={colors.brand} />
                      <Text style={{ color: colors.brand, fontWeight: "600" }}>{speaking === index ? "Playing…" : "Listen"}</Text>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => void Clipboard.setStringAsync(item.content)}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name="copy-outline" size={16} color={colors.brand} />
                      <Text style={{ color: colors.brand, fontWeight: "600" }}>Copy</Text>
                    </View>
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />

      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.line, backgroundColor: "#fff", alignItems: "flex-end" }}>
        <Pressable
          onPressIn={() => void mic.start("mic", () => void releaseMic())}
          onPressOut={() => void releaseMic()}
          disabled={disabled || sending || Boolean(mic.busy)}
          accessibilityLabel="Hold to dictate"
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: mic.recording ? colors.danger : colors.accentSoft }}
        >
          {mic.busy ? <Text style={{ color: colors.accent }}>…</Text> : <Icon name={mic.recording ? "mic" : "mic-outline"} size={22} color={mic.recording ? "#fff" : colors.accent} />}
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={mic.recording ? "Listening…" : "Ask the assistant…"}
          placeholderTextColor={colors.muted}
          multiline
          maxLength={4000}
          editable={!disabled}
          style={[styles.input, { flex: 1, maxHeight: 120 }]}
        />
        <Pressable
          onPress={() => void send(draft)}
          disabled={disabled || sending || !draft.trim()}
          accessibilityLabel="Send"
          style={{ height: 48, width: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, opacity: disabled || sending || !draft.trim() ? 0.5 : 1 }}
        >
          <Icon name="arrow-up" size={22} color="#fff" />
        </Pressable>
      </View>
      {messages.length > 0 && (
        <Pressable onPress={() => setMessages([])} style={{ position: "absolute", top: 12, right: 16 }}>
          <Text style={{ color: colors.muted }}>New chat</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}
