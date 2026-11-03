import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";

import { api, isMemberView } from "../../api";
import { Banner, Button, Card, Muted, Screen, styles } from "../../components/ui";
import { languageName } from "../../lib/languages";
import type { Room } from "../../types";

export default function Summary() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let tries = 0;
    const load = () =>
      api
        .room(code)
        .then((r) => {
          if (!isMemberView(r)) throw new Error("You were not part of this call.");
          setRoom(r);
          if (r.usage && !r.usage.finalized && tries++ < 3) setTimeout(load, 2000);
        })
        .catch((err) => setError(err.message));
    load();
  }, [code]);

  const usage = room?.usage;
  const e2e = usage?.latency?.end_to_audio_ms;

  return (
    <Screen>
      <ScrollView>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {room && (
          <>
            <Card>
              <Text style={styles.label}>
                {Math.floor(room.duration_seconds / 60)} min {room.duration_seconds % 60} s
              </Text>
              <Muted>{room.participants.map((p) => `${p.display_name}${p.is_you ? " (you)" : ""} — ${languageName(p.spoken_language)}`).join("\n")}</Muted>
            </Card>
            {usage && (
              <Card>
                <Text style={styles.label}>AI usage</Text>
                <Muted>
                  {usage.utterances} sentences · {Math.round(usage.stt_seconds)} s recognised · {usage.translate_chars} chars translated ·{" "}
                  {usage.tts_chars} chars spoken
                </Muted>
                {e2e && (
                  <Muted style={{ marginTop: 6 }}>
                    Translation delay after each sentence: median {(e2e.p50 / 1000).toFixed(1)} s, slowest {(e2e.max / 1000).toFixed(1)} s
                  </Muted>
                )}
              </Card>
            )}
          </>
        )}
        <Button label="Back to home" onPress={() => router.replace("/home")} />
      </ScrollView>
    </Screen>
  );
}
