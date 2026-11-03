import {
  AndroidAudioTypePresets,
  AudioSession,
  LiveKitRoom,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
} from "@livekit/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ConnectionState } from "livekit-client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PermissionsAndroid, Platform, ScrollView, Text, View, type ScrollViewInstance } from "react-native";

import { ApiError, api, meetingsApi } from "../../api";
import { Banner, Button, Card, Chip, Muted, Screen, colors } from "../../components/ui";
import { formatClock } from "../../lib/meetings";
import { initialTranslatorState, parseTranslatorMessage, translatorReducer } from "../../lib/translatorEvents";
import type { TokenResponse } from "../../types";

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: "Microphone access",
    message: "Your voice is transcribed and translated live.",
    buttonPositive: "Allow",
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Live meeting on the phone: the LiveKit translation worker transcribes (and translates) the
 * microphone in real time and saves the transcript. The phone does not save the audio.
 */
export default function LiveMeetingScreen() {
  const { meetingId, code } = useLocalSearchParams<{ meetingId: string; code: string }>();
  const [session, setSession] = useState<TokenResponse | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      await AudioSession.configureAudio({ android: { audioTypeOptions: AndroidAudioTypePresets.communication } });
      if (active) await AudioSession.startAudioSession();
    })();
    return () => {
      active = false;
      void AudioSession.stopAudioSession();
    };
  }, []);

  const connect = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    try {
      if (!(await ensureMicPermission())) {
        setError("Microphone permission is required. Enable it in Android Settings → Apps.");
        return;
      }
      setSession(await api.token(code));
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) router.replace(`/meetings/${meetingId}`);
      else setError(err instanceof ApiError ? err.message : "Could not start the live session");
    } finally {
      inFlight.current = false;
    }
  }, [code, meetingId]);

  useEffect(() => {
    void connect();
  }, [connect]);

  if (!session) {
    return (
      <Screen>
        {error ? <Banner tone="danger">{error}</Banner> : <Muted>Connecting…</Muted>}
        {error ? (
          <View style={{ gap: 10 }}>
            <Button label="Try again" onPress={() => void connect()} />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => void api.end(code).catch(() => undefined).then(() => router.replace(`/meetings/${meetingId}`))}
            />
          </View>
        ) : null}
      </Screen>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={session.url}
      token={session.token}
      connect
      audio
      video={false}
      options={{ adaptiveStream: false, dynacast: false }}
      onDisconnected={() => router.replace(`/meetings/${meetingId}`)}
      onError={(err) => {
        if (!/client initiated disconnect/i.test(err.message)) setError(err.message);
      }}
    >
      <LiveView meetingId={meetingId} code={code} session={session} error={error} />
    </LiveKitRoom>
  );
}

function LiveView({ meetingId, code, session, error }: { meetingId: string; code: string; session: TokenResponse; error: string }) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const remotes = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [state, dispatch] = useReducer(translatorReducer, initialTranslatorState);
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);
  const started = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const maxSeconds = session.room.max_duration_seconds;

  useDataChannel("translator", (msg) => {
    if (msg.from && !msg.from.isAgent) return;
    const parsed = parseTranslatorMessage(msg.payload);
    if (parsed) dispatch(parsed);
  });

  // Anchor transcript timestamps to the moment the microphone went live.
  useEffect(() => {
    if (connection !== ConnectionState.Connected || started.current) return;
    started.current = true;
    void meetingsApi.liveStarted(meetingId, Date.now()).catch(() => undefined);
  }, [connection, meetingId]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (elapsed >= maxSeconds - 2 && !ending) void finish();
  }, [elapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    setEnding(true);
    await api.end(code).catch(() => undefined);
    await room.disconnect(); // onDisconnected opens the saved meeting
  }

  const translatorReady = remotes.some((p) => p.isAgent);
  const partials = Object.values(state.partialBySpeaker);

  return (
    <Screen style={{ paddingBottom: 0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <Chip label={connection === ConnectionState.Connected ? "Connected" : "Connecting…"} tone={connection === ConnectionState.Connected ? "accent" : "warn"} />
        <Chip
          label={state.availability === "disabled" ? "AI unavailable" : translatorReady ? "Live transcription on" : "Transcriber joining…"}
          tone={translatorReady ? "brand" : "muted"}
        />
        <Chip label={isMicrophoneEnabled ? "Listening" : "Paused"} tone={isMicrophoneEnabled ? "warn" : "muted"} />
        <Chip label={`${formatClock(elapsed * 1000)} / ${formatClock(maxSeconds * 1000)}`} />
      </View>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {state.availability === "limit" && <Banner tone="warn">Live AI processing stopped: usage limit reached.</Banner>}
      {maxSeconds - elapsed < 60 && maxSeconds - elapsed > 0 && <Banner tone="warn">Session ends in {maxSeconds - elapsed} s (duration limit).</Banner>}

      <Card style={{ flex: 1, padding: 0 }}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, gap: 10 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {state.lines.length === 0 && partials.length === 0 && <Muted>The live transcript appears here when you speak.</Muted>}
          {state.lines.map((line) => (
            <View key={line.id} style={{ backgroundColor: "#f1f5f9", borderRadius: 14, padding: 10, opacity: line.skipped ? 0.5 : 1 }}>
              <Text style={{ fontSize: 16, color: colors.ink }}>{line.original}</Text>
              {line.translation && line.translation !== line.original ? (
                <Text style={{ fontSize: 14, color: colors.brand, marginTop: 4 }}>{line.translation}</Text>
              ) : null}
            </View>
          ))}
          {partials.map((text, i) => (
            <Text key={i} style={{ fontStyle: "italic", color: colors.muted }}>
              {text}…
            </Text>
          ))}
        </ScrollView>
      </Card>

      <View style={{ flexDirection: "row", gap: 10, paddingVertical: 12 }}>
        <Button
          label={isMicrophoneEnabled ? "Pause" : "Resume"}
          variant="secondary"
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          disabled={ending}
          style={{ flex: 1 }}
        />
        <Button label={ending ? "Saving…" : "Stop and save"} variant="danger" onPress={() => void finish()} disabled={ending} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
