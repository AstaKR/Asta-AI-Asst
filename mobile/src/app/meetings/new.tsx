import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";

import { ApiError, meetingsApi, type UploadFile } from "../../api";
import { MeetingSetup, defaultMeetingSetup, type MeetingSetupValue } from "../../components/MeetingSetup";
import { Banner, Button, Card, Muted, Screen, colors, styles } from "../../components/ui";
import { checkUploadFile, formatClock } from "../../lib/meetings";
import type { MeetingConfig } from "../../types";

type Tab = "live" | "record" | "upload";
const TABS: { key: Tab; title: string }[] = [
  { key: "live", title: "Live translate" },
  { key: "record", title: "Record" },
  { key: "upload", title: "Upload" },
];

export default function NewMeetingScreen() {
  const [tab, setTab] = useState<Tab>("live");
  const [config, setConfig] = useState<MeetingConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    meetingsApi.config().then(setConfig).catch(() => setError("Could not load meeting settings from the server."));
  }, []);

  return (
    <Screen>
      <View style={{ flexDirection: "row", backgroundColor: "#e2e8f0", borderRadius: 12, padding: 4, marginBottom: 14 }} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 9, backgroundColor: tab === t.key ? "#fff" : "transparent", alignItems: "center" }}
          >
            <Text style={{ fontWeight: "700", color: tab === t.key ? colors.ink : colors.muted }}>{t.title}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
        {config && tab === "live" && <LiveForm config={config} />}
        {config && tab === "record" && <RecordForm config={config} />}
        {config && tab === "upload" && <UploadForm config={config} />}
        <Muted style={{ marginTop: 10, fontSize: 12 }}>
          Sources: this phone’s microphone and audio files. Normal phone calls cannot be recorded by apps on Android or iPhone; to
          translate a conversation, start a call in this app.
        </Muted>
      </ScrollView>
    </Screen>
  );
}

function LiveForm({ config }: { config: MeetingConfig }) {
  const [setup, setSetup] = useState<MeetingSetupValue>(defaultMeetingSetup());
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await meetingsApi.startLive({ ...setup, voice_playback: voice });
      router.push({ pathname: "/meetings/live", params: { meetingId: res.meeting.id, code: res.room_code } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the live session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Muted style={{ marginBottom: 12 }}>
        See a live transcript and translation while you speak. On the phone, the live transcript is saved (not the audio) — use
        Record if you also need the audio.
      </Muted>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!config.translation_enabled && <Banner tone="warn">Live AI processing is turned off on the server.</Banner>}
      <MeetingSetup value={setup} onChange={setSetup} allowAuto={false} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
        <Text style={[styles.label, { flex: 1, marginBottom: 0 }]}>Speak the translation aloud</Text>
        <Switch value={voice} disabled={!setup.translation_language} onValueChange={setVoice} trackColor={{ true: colors.brand }} />
      </View>
      <Button
        label="Start live session"
        onPress={() => void start()}
        busy={busy}
        disabled={!setup.consent || !setup.title.trim() || !config.translation_enabled}
        style={{ marginTop: 16 }}
      />
    </Card>
  );
}

function uploadFields(setup: MeetingSetupValue, source: "upload" | "recording"): Record<string, string> {
  return {
    title: setup.title,
    source,
    spoken_language: setup.spoken_language,
    translation_language: setup.translation_language,
    consent: String(setup.consent),
  };
}

function RecordForm({ config }: { config: MeetingConfig }) {
  // Mono 64 kbps AAC (.m4a): small uploads, plenty for speech.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 });
  const status = useAudioRecorderState(recorder);
  const [setup, setSetup] = useState<MeetingSetupValue>(defaultMeetingSetup("auto"));
  const [phase, setPhase] = useState<"idle" | "recording" | "paused" | "stopped" | "uploading">("idle");
  const [uri, setUri] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (phase === "recording" && status.durationMillis / 1000 >= config.max_duration_seconds) void stop();
  }, [status.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError("");
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return setError("Microphone permission is required. Enable it in Settings → Apps.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase("recording");
  }

  function pause() {
    recorder.pause();
    setPhase("paused");
  }

  function resume() {
    recorder.record();
    setPhase("recording");
  }

  async function stop() {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setUri(recorder.uri);
    setPhase("stopped");
  }

  async function upload() {
    if (!uri) return;
    setPhase("uploading");
    try {
      const file: UploadFile = { uri, name: "recording.m4a", type: "audio/mp4" };
      const meeting = await meetingsApi.upload(uploadFields(setup, "recording"), file, setProgress);
      router.replace(`/meetings/${meeting.id}`);
    } catch (err) {
      setPhase("stopped");
      setError(err instanceof ApiError ? err.message : "Upload failed");
    }
  }

  return (
    <Card>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <MeetingSetup value={setup} onChange={setSetup} />
      <View style={{ alignItems: "center", marginVertical: 18 }}>
        <Text style={{ fontSize: 40, fontWeight: "700", fontVariant: ["tabular-nums"], color: phase === "recording" ? colors.danger : colors.ink }}>
          {formatClock(status.durationMillis)}
        </Text>
        <Muted>{phase === "recording" ? "Recording" : phase === "paused" ? "Paused" : phase === "stopped" ? "Stopped" : phase === "uploading" ? `Uploading ${Math.round(progress * 100)}%` : "Ready"}</Muted>
      </View>
      {phase === "idle" && <Button label="Start recording" onPress={() => void start()} disabled={!setup.consent || !setup.title.trim()} />}
      {(phase === "recording" || phase === "paused") && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button label={phase === "recording" ? "Pause" : "Resume"} variant="secondary" onPress={phase === "recording" ? pause : resume} style={{ flex: 1 }} />
          <Button label="Stop" variant="danger" onPress={() => void stop()} style={{ flex: 1 }} />
        </View>
      )}
      {phase === "stopped" && <Button label="Upload and transcribe" onPress={() => void upload()} disabled={!setup.consent} />}
      {phase === "uploading" && <Button label={`Uploading ${Math.round(progress * 100)}%…`} onPress={() => undefined} busy />}
    </Card>
  );
}

function UploadForm({ config }: { config: MeetingConfig }) {
  const [setup, setSetup] = useState<MeetingSetupValue>(defaultMeetingSetup("auto"));
  const [file, setFile] = useState<(UploadFile & { size: number }) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function pick() {
    setError("");
    const result = await DocumentPicker.getDocumentAsync({ type: ["audio/*", "video/mp4"], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const problem = checkUploadFile({ name: a.name, size: a.size ?? 0 }, config);
    if (problem) return setError(problem);
    setFile({ uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream", size: a.size ?? 0 });
    if (setup.title.startsWith("Meeting ")) setSetup({ ...setup, title: a.name.replace(/\.[^.]+$/, "") });
  }

  async function upload() {
    if (!file) return;
    setProgress(0);
    try {
      const meeting = await meetingsApi.upload(uploadFields(setup, "upload"), file, setProgress);
      router.replace(`/meetings/${meeting.id}`);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : "Upload failed");
    }
  }

  return (
    <Card>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button label={file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : "Choose audio file"} variant="secondary" onPress={() => void pick()} />
      <Muted style={{ marginTop: 6, marginBottom: 14, fontSize: 12 }}>
        {config.allowed_extensions.join(", ")} · up to {config.max_upload_mb} MB · up to {Math.round(config.max_duration_seconds / 60)} min
      </Muted>
      <MeetingSetup value={setup} onChange={setSetup} />
      <Button
        label={progress !== null ? `Uploading ${Math.round(progress * 100)}%…` : "Upload and transcribe"}
        onPress={() => void upload()}
        busy={progress !== null}
        disabled={!file || !setup.consent || !setup.title.trim()}
        style={{ marginTop: 16 }}
      />
    </Card>
  );
}
