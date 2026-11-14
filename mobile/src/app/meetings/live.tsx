import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, type ScrollViewInstance } from "react-native";

import { ApiError, meetingsApi } from "../../api";
import { Banner, Button, Card, Chip, Muted, Screen, colors } from "../../components/ui";
import { formatClock } from "../../lib/meetings";
import { SPEECH_RECORDING } from "../../lib/recording";
import type { MeetingDetail, TranscriptSegment } from "../../types";

const CHUNK_SECONDS = 40; // every chunk is a complete file the server can transcribe on its own
const NOTES_EVERY_SECONDS = 90;
const SPEAKER_COLORS = [colors.brand, colors.accent, colors.warn, colors.danger, colors.muted];

/**
 * In-person group meeting: the phone sits on the table and records. Every ~40 s a chunk is sent for transcription
 * (the server labels who spoke), and the notes refresh every minute or two. Ending the meeting joins the audio
 * and writes the final notes. No video-call service is involved.
 */
export default function LiveMeetingScreen() {
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [notes, setNotes] = useState<MeetingDetail | null>(null);
  const [pending, setPending] = useState(0);
  const [phase, setPhase] = useState<"starting" | "live" | "saving">("starting");
  const [error, setError] = useState("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const running = useRef(false);
  const rotating = useRef(false);
  const segCount = useRef(0);
  const scroller = useRef<ScrollViewInstance | null>(null);
  const colorFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of segments) if (!m.has(s.speaker || "?")) m.set(s.speaker || "?", SPEAKER_COLORS[m.size % SPEAKER_COLORS.length]);
    return m;
  }, [segments]);

  const upload = useCallback(
    (uri: string) => {
      setPending((n) => n + 1);
      // One at a time, in order: the server numbers lines by arrival.
      queue.current = queue.current.then(async () => {
        try {
          const res = await meetingsApi.sendChunk(meetingId, { uri, name: "chunk.m4a", type: "audio/mp4" });
          segCount.current += res.segments.length;
          setSegments((s) => [...s, ...res.segments]);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "A piece of audio could not be transcribed.");
        } finally {
          setPending((n) => n - 1);
          const f = new File(uri);
          if (f.exists) f.delete();
        }
      });
    },
    [meetingId],
  );

  /** Stops the current recording, sends it, and (unless ending) starts the next one straight away. */
  const rotate = useCallback(
    async (again: boolean) => {
      if (rotating.current) return;
      rotating.current = true;
      try {
        await recorder.stop();
        if (recorder.uri) upload(recorder.uri);
        if (again && running.current) {
          await recorder.prepareToRecordAsync();
          recorder.record();
        }
      } catch {
        setError("The recording was interrupted. End the meeting to save what you have.");
      } finally {
        rotating.current = false;
      }
    },
    [recorder, upload],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return setError("Microphone permission is required. Enable it in Settings → Apps.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
      await recorder.prepareToRecordAsync();
      if (cancelled) return;
      recorder.record();
      running.current = true;
      setPhase("live");
    })().catch(() => setError("Could not start the microphone."));
    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [recorder]);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => void rotate(true), CHUNK_SECONDS * 1000);
    return () => clearInterval(id);
  }, [phase, rotate]);

  const refreshNotes = useCallback(async () => {
    if (!segCount.current) return;
    try {
      setNotes(await meetingsApi.liveNotes(meetingId));
    } catch (err) {
      // 400: nothing said yet; 503: notes not configured on the server. Neither needs a banner.
      if (!(err instanceof ApiError && (err.status === 400 || err.status === 503))) setError(err instanceof ApiError ? err.message : "Could not refresh the notes.");
    }
  }, [meetingId]);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => void refreshNotes(), NOTES_EVERY_SECONDS * 1000);
    return () => clearInterval(id);
  }, [phase, refreshNotes]);

  async function end() {
    setPhase("saving");
    running.current = false;
    await rotate(false);
    await queue.current;
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      await meetingsApi.finishLive(meetingId);
      router.replace(`/meetings/${meetingId}`);
    } catch (err) {
      setPhase("live");
      running.current = false;
      setError(err instanceof ApiError ? err.message : "Could not finish the meeting. Try again.");
    }
  }

  const summary = notes?.summary;

  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Chip label={phase === "live" ? "Recording" : phase === "saving" ? "Saving…" : "Starting…"} tone={phase === "live" ? "danger" : "muted"} />
        <Chip label={formatClock(elapsed * 1000)} />
        {pending > 0 ? <Chip label="Transcribing…" tone="brand" /> : null}
      </View>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ paddingBottom: 16, gap: 10 }}>
        <Card>
          <Muted style={{ marginBottom: 6 }}>Transcript</Muted>
          {segments.length === 0 ? <Muted>Put the phone in the middle of the table and talk. Lines appear about {CHUNK_SECONDS} seconds after you speak.</Muted> : null}
          {segments.map((s) => (
            <Text key={s.index} style={{ color: colors.ink, fontSize: 15, lineHeight: 22, marginBottom: 6 }}>
              <Text style={{ color: colorFor.get(s.speaker || "?"), fontWeight: "700" }}>{s.speaker || "Speaker"}  </Text>
              {s.original_text}
            </Text>
          ))}
        </Card>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Muted>Live notes</Muted>
            <Text onPress={() => void refreshNotes()} style={{ color: colors.brand, fontSize: 13 }} accessibilityRole="button">
              Refresh now
            </Text>
          </View>
          {!summary ? <Muted style={{ marginTop: 6 }}>Notes appear after the first minute or two of talking.</Muted> : null}
          {summary ? (
            <View style={{ marginTop: 8, gap: 8 }}>
              <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 21 }}>{summary.summary}</Text>
              {summary.decisions.length > 0 ? <NoteList title="Decisions" items={summary.decisions.map((d) => d.text)} /> : null}
              {notes && notes.action_items.length > 0 ? (
                <NoteList title="Action items" items={notes.action_items.map((a) => (a.owner_name ? `${a.text} — ${a.owner_name}` : a.text))} />
              ) : null}
              {summary.open_questions.length > 0 ? <NoteList title="Open questions" items={summary.open_questions.map((q) => q.text)} /> : null}
            </View>
          ) : null}
        </Card>
      </ScrollView>
      <Button label={phase === "saving" ? "Saving…" : "End meeting and save"} variant="danger" onPress={() => void end()} busy={phase === "saving"} disabled={phase === "starting"} />
    </Screen>
  );
}

function NoteList({ title, items }: { title: string; items: string[] }) {
  return (
    <View>
      <Muted style={{ fontSize: 12, textTransform: "uppercase" }}>{title}</Muted>
      {items.map((t, i) => (
        <Text key={i} style={{ color: colors.ink, fontSize: 14, lineHeight: 20, marginTop: 3 }}>
          • {t}
        </Text>
      ))}
    </View>
  );
}
