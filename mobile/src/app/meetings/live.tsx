import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type ScrollViewInstance } from "react-native";

import { ApiError, meetingsApi } from "../../api";
import { FadeIn, LevelOrb, SEAT_COLORS, Seats, type Seat } from "../../components/MeetingViz";
import { Banner, Button, Card, Chip, Muted, Screen, colors } from "../../components/ui";
import { formatClock } from "../../lib/meetings";
import { SPEECH_RECORDING } from "../../lib/recording";
import type { MeetingDetail, TranscriptSegment } from "../../types";

const CHUNK_SECONDS = 40; // every chunk is a complete file the server can transcribe on its own
const NOTES_EVERY_SECONDS = 90;
type NotesTab = "summary" | "decisions" | "actions" | "questions";

/**
 * In-person group meeting: the phone sits on the table and records. Every ~40 s a chunk is sent for transcription
 * (the server labels who spoke), and the notes refresh every minute or two. Ending the meeting joins the audio
 * and writes the final notes. No video-call service is involved.
 */
export default function LiveMeetingScreen() {
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const recorder = useAudioRecorder({ ...SPEECH_RECORDING, isMeteringEnabled: true });
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
  const [levelDb, setLevelDb] = useState(-60);
  const [tab, setTab] = useState<NotesTab>("summary");
  // Who is at the table: in order of first appearance, with word counts; the last speaker is highlighted.
  const seats: Seat[] = useMemo(() => {
    const order: string[] = [];
    const words = new Map<string, number>();
    for (const s of segments) {
      const name = s.speaker || "Speaker";
      if (!words.has(name)) order.push(name);
      words.set(name, (words.get(name) ?? 0) + s.original_text.split(/\s+/).filter(Boolean).length);
    }
    const last = segments.length ? segments[segments.length - 1].speaker || "Speaker" : "";
    return order.map((name, i) => ({ name, color: SEAT_COLORS[i % SEAT_COLORS.length], words: words.get(name) ?? 0, active: name === last }));
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

  // Drives the orb: the microphone level, about ten times a second.
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      try {
        setLevelDb(recorder.getStatus().metering ?? -60);
      } catch {
        /* between chunks the recorder is briefly not ready */
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, recorder]);

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
  const colorOf = (speaker: string) => seats.find((x) => x.name === (speaker || "Speaker"))?.color ?? SEAT_COLORS[0];
  const tabs: { key: NotesTab; label: string; count?: number }[] = [
    { key: "summary", label: "Summary" },
    { key: "decisions", label: "Decisions", count: summary?.decisions.length },
    { key: "actions", label: "Actions", count: notes?.action_items.length },
    { key: "questions", label: "Open", count: summary?.open_questions.length },
  ];

  return (
    <Screen>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 4, flexWrap: "wrap", justifyContent: "center" }}>
        <Chip label={phase === "live" ? "REC" : phase === "saving" ? "Saving…" : "Starting…"} tone={phase === "live" ? "danger" : "muted"} />
        <Chip label={formatClock(elapsed * 1000)} />
        {pending > 0 ? <Chip label="Transcribing…" tone="brand" /> : null}
      </View>
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ paddingBottom: 16, gap: 12 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <LevelOrb levelDb={levelDb} active={phase === "live"} />
          <Seats seats={seats} />
          {seats.length === 0 ? <Muted style={{ textAlign: "center" }}>Put the phone in the middle of the table and talk.{"\n"}Speakers take their seats about {CHUNK_SECONDS} seconds after they speak.</Muted> : null}
        </View>
        <Card>
          <Muted style={{ marginBottom: 8 }}>Conversation</Muted>
          {segments.length === 0 ? <Muted>Lines appear here as people talk.</Muted> : null}
          {segments.map((s) => (
            <FadeIn key={s.index}>
              <View style={{ borderLeftWidth: 3, borderLeftColor: colorOf(s.speaker), paddingLeft: 10, marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colorOf(s.speaker), fontWeight: "800", fontSize: 11, textTransform: "uppercase" }}>{s.speaker || "Speaker"}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{formatClock(s.start_ms)}</Text>
                </View>
                <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{s.original_text}</Text>
              </View>
            </FadeIn>
          ))}
        </Card>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Muted>Live notes</Muted>
            <Text onPress={() => void refreshNotes()} style={{ color: colors.brand, fontSize: 13 }} accessibilityRole="button">
              Refresh now
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {tabs.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.key }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tab === t.key ? colors.brandSoft : colors.subtle, borderWidth: 1, borderColor: tab === t.key ? colors.brand : colors.line }}
              >
                <Text style={{ color: tab === t.key ? colors.ink : colors.muted, fontWeight: "700", fontSize: 12 }}>
                  {t.label}
                  {t.count ? `  ${t.count}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          {!summary ? <Muted>Notes appear after the first minute or two of talking.</Muted> : null}
          {summary ? (
            <FadeIn key={tab}>
              {tab === "summary" ? <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{summary.summary}</Text> : null}
              {tab === "decisions" ? <NoteList items={summary.decisions.map((d) => d.text)} empty="No decisions yet." /> : null}
              {tab === "actions" ? (
                <NoteList items={(notes?.action_items ?? []).map((a) => [a.text, a.owner_name, a.deadline].filter(Boolean).join(" — "))} empty="No action items yet." />
              ) : null}
              {tab === "questions" ? <NoteList items={summary.open_questions.map((q) => q.text)} empty="No open questions." /> : null}
            </FadeIn>
          ) : null}
        </Card>
      </ScrollView>
      <Button label={phase === "saving" ? "Saving…" : "End meeting and save"} variant="danger" onPress={() => void end()} busy={phase === "saving"} disabled={phase === "starting"} />
    </Screen>
  );
}

function NoteList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <Muted>{empty}</Muted>;
  return (
    <View style={{ gap: 6 }}>
      {items.map((t, i) => (
        <Text key={i} style={{ color: colors.ink, fontSize: 14, lineHeight: 20 }}>
          •  {t}
        </Text>
      ))}
    </View>
  );
}
