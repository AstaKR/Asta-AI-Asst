import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { ApiError, meetingsApi } from "../api";
import { formatClock } from "../lib/meetings";
import type { MeetingAnswer } from "../types";
import { Banner, Button, Muted, colors, styles } from "./ui";

/** Recall: ask a question across all of your own meetings; the answer links to the meeting and moment. */
export function AskMeetings() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      setAnswer(await meetingsApi.ask(q));
    } catch (err) {
      setAnswer(null);
      setError(err instanceof ApiError ? err.message : "Could not get an answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          placeholder="Ask your meetings… e.g. what did we decide?"
          placeholderTextColor={colors.muted}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => void ask()}
          returnKeyType="search"
          maxLength={500}
          style={[styles.input, { flex: 1 }]}
          accessibilityLabel="Ask your meetings"
        />
        <Button label="Ask" onPress={() => void ask()} busy={busy} disabled={!question.trim()} />
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {answer ? (
        <View style={[styles.card, { gap: 8 }]} accessibilityLiveRegion="polite">
          <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{answer.answer}</Text>
          {answer.sources.map((s, i) => (
            <Pressable key={i} onPress={() => router.push(`/meetings/${s.meeting_id}`)} accessibilityRole="link">
              <Muted style={{ color: colors.brand, fontSize: 13 }}>
                {s.title} · {new Date(s.recorded_at).toLocaleDateString()}
                {s.start_ms != null ? ` · ${formatClock(s.start_ms)}` : ""}
              </Muted>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
