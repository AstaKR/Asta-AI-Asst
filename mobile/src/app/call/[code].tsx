import {
  AndroidAudioTypePresets,
  AudioSession,
  LiveKitRoom,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { ConnectionState, DisconnectReason, LocalVideoTrack, ParticipantKind, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PermissionsAndroid, Platform, ScrollView, Share, Text, View } from "react-native";

import { ApiError, api, phoneApi } from "../../api";
import { useAuth } from "../../auth";
import { Banner, Button, Card, Chip, Muted, Screen, colors, styles } from "../../components/ui";
import { effectiveLanguage, micAllowedIdentities, needsTranslation, originalVolume } from "../../lib/audioPolicy";
import { NATIVE_NAMES, languageName } from "../../lib/languages";
import { initialTranslatorState, parseTranslatorMessage, translatorReducer } from "../../lib/translatorEvents";
import type { Room, TokenResponse } from "../../types";

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true; // iOS prompts on first use (NSMicrophoneUsageDescription)
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: "Microphone access",
    message: "Your voice is sent in the call so it can be translated.",
    buttonPositive: "Allow",
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Video calls only. Refusing keeps the call going with audio. */
async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true; // NSCameraUsageDescription
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
    title: "Camera access",
    message: "Your camera is shown to the other person in video calls.",
    buttonPositive: "Allow",
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// ~360p keeps mobile data use modest; translation does not depend on video quality.
const CAMERA_OPTIONS = { resolution: { width: 640, height: 360, frameRate: 24 } };

export default function CallScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [session, setSession] = useState<TokenResponse | null>(null);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const inFlight = useRef(false);

  // Route audio like a phone call (earpiece/speaker, echo cancellation, audio focus).
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
    setDisconnected(false);
    try {
      if (!(await ensureMicPermission())) {
        setError("Microphone permission is required for calls. Enable it in Android Settings → Apps.");
        return;
      }
      const token = await api.token(code);
      setCamera(token.room.video_enabled && (await ensureCameraPermission()));
      setSession(token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) router.replace(`/summary/${code}`);
      else setError(err instanceof ApiError ? err.message : "Could not connect to the call");
    } finally {
      inFlight.current = false;
    }
  }, [code]);

  useEffect(() => {
    void connect();
  }, [connect]);

  const onDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.CLIENT_INITIATED) {
        router.replace(`/summary/${code}`);
      } else {
        setSession(null);
        setDisconnected(true);
      }
    },
    [code],
  );

  if (!session) {
    return (
      <Screen>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {disconnected && <Banner tone="warn">You were disconnected. The call may still be running.</Banner>}
        {!error && !disconnected ? (
          <Muted>Connecting…</Muted>
        ) : (
          <View style={{ gap: 10 }}>
            <Button label="Reconnect" onPress={() => void connect()} />
            <Button label="Leave" variant="secondary" onPress={() => router.replace(`/summary/${code}`)} />
          </View>
        )}
      </Screen>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={session.url}
      token={session.token}
      connect
      audio
      video={camera ? CAMERA_OPTIONS : false}
      options={{ adaptiveStream: false, dynacast: false, videoCaptureDefaults: CAMERA_OPTIONS }}
      onDisconnected={onDisconnected}
      onError={(err) => {
        if (!/client initiated disconnect/i.test(err.message)) setError(err.message);
      }}
    >
      <CallView code={code} session={session} error={error} />
    </LiveKitRoom>
  );
}

const ACTIVITY: Record<string, string> = {
  listening: "Speaking…",
  transcribing: "Recognising speech…",
  translating: "Translating…",
  speaking: "Playing translation…",
  reconnecting: "Recognition reconnecting…",
  error: "Last sentence failed",
  limit: "Translation stopped",
};

function CallView({ code, session, error }: { code: string; session: TokenResponse; error: string }) {
  const room = useRoomContext();
  const { user } = useAuth();
  const navigation = useNavigation();
  const connection = useConnectionState();
  const remotes = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [state, dispatch] = useReducer(translatorReducer, initialTranslatorState);
  const [info] = useState<Room>(session.room);
  // Video calls default to the loudspeaker: the phone is held away from the ear.
  const [speaker, setSpeaker] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [ending, setEnding] = useState(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    room.on(RoomEvent.ParticipantAttributesChanged, bump);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, bump);
    };
  }, [room]);

  useDataChannel("translator", (msg) => {
    if (msg.from && !msg.from.isAgent) return;
    const parsed = parseTranslatorMessage(msg.payload);
    if (parsed) dispatch(parsed);
  });

  const myIdentity = session.identity;
  const me = info.participants.find((p) => p.is_you);
  const myListen = localParticipant.attributes.listen_language || me?.listen_language;
  const mySpoken = localParticipant.attributes.spoken_language || me?.spoken_language;
  const other = remotes.find((p) => !p.isAgent);
  const agent = remotes.find((p) => p.isAgent);
  const otherIsPhone = other?.kind === ParticipantKind.SIP;
  const otherName = other?.name || info.participants.find((p) => !p.is_you)?.display_name || "Caller";
  const otherSpoken = effectiveLanguage(other?.attributes.spoken_language, other ? state.languageBySpeaker[other.identity] : undefined);
  const otherListen = other?.attributes.listen_language;
  const translatorAvailable = info.translation_enabled && Boolean(agent) && !["disabled", "limit", "error"].includes(state.availability);
  const theyNeedTranslation = needsTranslation(mySpoken, otherListen) || (otherIsPhone && !otherListen);
  const origVolume = user?.preferences.original_voice_volume ?? 15;

  // Normal phone call bridged through LiveKit SIP: sip.callStatus is dialing → active → hangup.
  const phone = info.phone;
  const sipStatus = other?.attributes["sip.callStatus"];
  const phoneLive = Boolean(phone && other && (sipStatus === "active" || (phone.direction === "inbound" && sipStatus !== "hangup")));
  const reported = useRef(false);
  useEffect(() => {
    if (!phone || phone.direction !== "outbound" || sipStatus !== "active" || reported.current) return;
    reported.current = true;
    void phoneApi.connected(phone.id).catch(() => undefined);
  }, [phone, sipStatus]);

  useEffect(() => {
    navigation.setOptions({ title: phone ? phone.remote_number || "Phone call" : other ? otherName : "Waiting…" });
  }, [navigation, other, otherName, phone]);

  // Duck the other person's original voice under the translation (react-native-webrtc per-track volume).
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  useEffect(() => {
    for (const t of tracks) {
      if (t.participant.isLocal || t.participant.isAgent) continue;
      const volume = originalVolume({
        otherSpokenLanguage: effectiveLanguage(t.participant.attributes.spoken_language, state.languageBySpeaker[t.participant.identity]),
        myListenLanguage: myListen,
        translatorAvailable,
        originalVoiceVolume: origVolume,
      });
      const mst = t.publication?.track?.mediaStreamTrack as unknown as { _setVolume?: (v: number) => void } | undefined;
      mst?._setVolume?.(volume);
    }
  }, [tracks, myListen, translatorAvailable, origVolume, state.languageBySpeaker]);

  // Phone callers can't duck my original voice: while translation for them works, only the agent hears my mic.
  const agentIds = remotes.filter((p) => p.isAgent).map((p) => p.identity).join(",");
  useEffect(() => {
    const allowed = micAllowedIdentities({
      otherIsPhone,
      translationForOtherActive: theyNeedTranslation && translatorAvailable,
      agentIdentities: agentIds ? agentIds.split(",") : [],
    });
    localParticipant.setTrackSubscriptionPermissions(
      allowed === null,
      allowed?.map((participantIdentity) => ({ participantIdentity, allowAll: true })) ?? [],
    );
  }, [localParticipant, otherIsPhone, theyNeedTranslation, translatorAvailable, agentIds]);

  const cameras = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteCam = cameras.find((t) => !t.participant.isLocal && !t.participant.isAgent && t.publication?.track && !t.publication.isMuted);
  const localCam = cameras.find((t) => t.participant.isLocal && t.publication?.track && !t.publication.isMuted);

  const speakerSet = useRef(false);
  useEffect(() => {
    if (!info.video_enabled || connection !== ConnectionState.Connected || speakerSet.current || Platform.OS === "ios") return;
    speakerSet.current = true;
    void AudioSession.selectAudioOutput("speaker").then(() => setSpeaker(true));
  }, [info.video_enabled, connection]);

  async function toggleCamera() {
    if (!isCameraEnabled && Platform.OS === "android" && !(await ensureCameraPermission())) return;
    await localParticipant.setCameraEnabled(!isCameraEnabled, CAMERA_OPTIONS);
  }

  async function flipCamera() {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (!(track instanceof LocalVideoTrack)) return;
    const next = facing === "user" ? "environment" : "user";
    await track.restartTrack({ ...CAMERA_OPTIONS, facingMode: next });
    setFacing(next);
  }

  async function toggleSpeaker() {
    if (Platform.OS === "ios") return AudioSession.showAudioRoutePicker();
    const outputs = await AudioSession.getAudioOutputs();
    const next = speaker ? (outputs.includes("earpiece") ? "earpiece" : outputs[0]) : "speaker";
    if (next) {
      await AudioSession.selectAudioOutput(next);
      setSpeaker(!speaker);
    }
  }

  async function endCall() {
    setEnding(true);
    await api.end(code).catch(() => undefined);
    await room.disconnect();
  }

  const started = info.started_at ? new Date(info.started_at).getTime() : now;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const remaining = info.max_duration_seconds - elapsed;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const nameOf = (id: string) => (id === myIdentity ? "You" : id === other?.identity ? otherName : id);
  const partials = Object.entries(state.partialBySpeaker);

  return (
    <Screen style={{ paddingBottom: 0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <Chip
          label={connection === ConnectionState.Connected ? "Connected" : connection === ConnectionState.Reconnecting ? "Reconnecting…" : "Connecting…"}
          tone={connection === ConnectionState.Connected ? "accent" : "warn"}
        />
        <Chip
          label={!info.translation_enabled || state.availability === "disabled" ? "Translation off" : agent ? "AI translation active" : "Translator connecting…"}
          tone={agent && info.translation_enabled ? "brand" : "muted"}
        />
        <Chip label={`${clock(elapsed)} / ${clock(info.max_duration_seconds)}`} />
        {otherIsPhone && <Chip label="Phone call" tone="warn" />}
      </View>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {state.availability === "limit" && <Banner tone="warn">Translation stopped (usage limit). You hear the original voice.</Banner>}
      {state.availability === "disabled" && <Banner tone="warn">AI translation is unavailable on the server. You hear the original voice.</Banner>}
      {remaining < 60 && remaining > 0 && <Banner tone="warn">Call ends in {remaining} s (duration limit).</Banner>}

      {phone && !phoneLive ? (
        <Card>
          <Text style={styles.label}>{phone.direction === "outbound" ? "Calling" : "Connecting"} {phone.remote_number}</Text>
          <Muted>{other ? "Ringing… the call is translated once they answer." : "Dialling…"}</Muted>
        </Card>
      ) : !other ? (
        <Card>
          <Text style={styles.label}>Invite the other person</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", letterSpacing: 6, textAlign: "center", marginVertical: 10 }}>{code}</Text>
          <Button label="Share invite code" variant="secondary" onPress={() => Share.share({ message: `Join my translated call with code ${code}` })} />
        </Card>
      ) : (
        <Card>
          <Text style={styles.label}>{otherName}</Text>
          <Muted>
            You {NATIVE_NAMES[mySpoken ?? ""] ?? languageName(mySpoken)} → {NATIVE_NAMES[otherListen ?? ""] ?? "auto"} ·{" "}
            {otherName} {otherSpoken ? NATIVE_NAMES[otherSpoken] ?? otherSpoken : "detecting…"} → {NATIVE_NAMES[myListen ?? ""] ?? myListen}
          </Muted>
          <Muted style={{ marginTop: 4 }}>
            {state.activity[other.identity] ? ACTIVITY[state.activity[other.identity]] ?? "" : ""}
            {state.lastMetrics?.end_to_audio_ms !== undefined ? `  Last delay ${(state.lastMetrics.end_to_audio_ms / 1000).toFixed(1)} s` : ""}
          </Muted>
        </Card>
      )}

      {info.video_enabled && (
        <View style={{ height: 300, borderRadius: 16, overflow: "hidden", backgroundColor: "#0f172a", marginBottom: 10 }}>
          {remoteCam ? (
            <VideoTrack trackRef={remoteCam} style={{ flex: 1 }} objectFit="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#cbd5e1" }}>{other ? `${otherName}'s camera is off` : "Waiting for the other person…"}</Text>
            </View>
          )}
          {localCam ? (
            <View style={{ position: "absolute", right: 10, bottom: 10, width: 96, height: 128, borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: "#fff" }}>
              <VideoTrack trackRef={localCam} style={{ flex: 1 }} objectFit="cover" mirror={facing === "user"} zOrder={1} />
            </View>
          ) : null}
          {/* Latest translated line over the video, like captions. */}
          {state.lines.length > 0 && state.lines[state.lines.length - 1].speaker !== myIdentity ? (
            <View style={{ position: "absolute", left: 10, right: localCam ? 116 : 10, bottom: 10, backgroundColor: "rgba(15,23,42,0.75)", borderRadius: 10, padding: 8 }}>
              <Text style={{ color: "#fff", fontSize: 16 }} numberOfLines={3}>
                {state.lines[state.lines.length - 1].translation ?? state.lines[state.lines.length - 1].original}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {user?.preferences.show_subtitles !== false && (
        <Card style={{ flex: 1, padding: 0 }}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
            {state.lines.length === 0 && partials.length === 0 && <Muted>Subtitles appear here when someone speaks.</Muted>}
            {state.lines.map((line) => {
              const mine = line.speaker === myIdentity;
              const main = mine ? line.original : line.translation ?? line.original;
              const secondary = mine ? line.translation : line.translation ? line.original : undefined;
              return (
                <View
                  key={line.id}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    backgroundColor: mine ? colors.brand : "#f1f5f9",
                    borderRadius: 16,
                    padding: 10,
                    opacity: line.skipped ? 0.5 : 1,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: mine ? "#c7d2fe" : colors.muted }}>{nameOf(line.speaker).toUpperCase()}</Text>
                  <Text style={{ fontSize: 16, color: mine ? "#fff" : colors.ink, marginTop: 2 }}>{main}</Text>
                  {secondary ? <Text style={{ fontSize: 13, color: mine ? "#e0e7ff" : colors.muted, marginTop: 4 }}>{secondary}</Text> : null}
                </View>
              );
            })}
            {partials.map(([who, text]) => (
              <Text key={who} style={{ fontStyle: "italic", color: colors.muted }}>
                {nameOf(who)}: {text}…
              </Text>
            ))}
          </ScrollView>
        </Card>
      )}

      {info.video_enabled && (
        <View style={{ flexDirection: "row", gap: 10, paddingTop: 12 }}>
          <Button label={isCameraEnabled ? "Camera off" : "Camera on"} variant="secondary" onPress={() => void toggleCamera()} style={{ flex: 1 }} />
          <Button label="Flip camera" variant="secondary" onPress={() => void flipCamera()} disabled={!isCameraEnabled} style={{ flex: 1 }} />
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 10, paddingVertical: 12 }}>
        <Button
          label={isMicrophoneEnabled ? "Mute" : "Unmute"}
          variant="secondary"
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          style={{ flex: 1 }}
        />
        <Button label={speaker ? "Earpiece" : "Speaker"} variant="secondary" onPress={() => void toggleSpeaker()} style={{ flex: 1 }} />
        <Button label={ending ? "Ending…" : "End"} variant="danger" onPress={() => void endCall()} disabled={ending} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
