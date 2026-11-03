import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";

import { ApiError, type ExportKind, authHeaders, meetingsApi } from "../../api";
import { Banner, Button, Card, Muted, colors, styles, Icon } from "../../components/ui";
import { downloadAndShare } from "../../lib/download";
import { MEETING_LANGUAGES, activeSegmentIndex, formatClock, isProcessing, meetingLanguageName, searchSegments } from "../../lib/meetings";
import type { MeetingConfig, MeetingDetail, NotePoint, TranscriptSegment } from "../../types";

const EXPORT_MIME: Record<ExportKind, string> = {
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  json: "application/json",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};

const STATUS_TEXT: Record<string, string> = {
  queued: "Waiting to be processed…",
  transcribing: "Transcribing",
  translating: "Translating",
  summarizing: "Writing notes",
  live: "Live session in progress",
};

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [config, setConfig] = useState<MeetingConfig | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const [summaryPending, setSummaryPending] = useState(false);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<TranscriptSegment | null>(null);
  const stamp = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await meetingsApi.get(id);
      setMeeting(m);
      if (m.summary_generated_at !== stamp.current || m.summary_error) setSummaryPending(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "Meeting not found." : "Could not load the meeting.");
    }
  }, [id]);

  useEffect(() => {
    void load();
    meetingsApi.config().then(setConfig).catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (meeting) navigation.setOptions({ title: meeting.title });
  }, [meeting, navigation]);

  const working = meeting ? isProcessing(meeting.status) || meeting.status === "live" || summaryPending : false;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [working, load]);

  // Authenticated, range-enabled stream of the server's seekable MP3.
  const audioId = meeting?.has_audio ? meeting.id : null;
  const source = useMemo(() => (audioId ? { uri: meetingsApi.audioUrl(audioId), headers: authHeaders() } : null), [audioId]);
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  }, []);

  const seek = (ms: number) => {
    void player.seekTo(ms / 1000);
    player.play();
  };

  if (!meeting) return <View style={{ padding: 16 }}>{error ? <Banner tone="danger">{error}</Banner> : <Muted>Loading…</Muted>}</View>;

  const active = activeSegmentIndex(meeting.segments, status.currentTime * 1000);
  const segments = searchSegments(meeting.segments, query);
  const startOf = (index: number) => meeting.segments.find((s) => s.index === index)?.start_ms ?? 0;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${label} failed`);
    } finally {
      setBusy("");
    }
  }

  const header = (
    <View>
      <Muted style={{ marginBottom: 8 }}>
        {new Date(meeting.recorded_at).toLocaleString()} · {formatClock(meeting.duration_seconds * 1000)} · {meetingLanguageName(meeting.spoken_language)}
        {meeting.translation_language ? ` → ${meetingLanguageName(meeting.translation_language)}` : ""}
      </Muted>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {STATUS_TEXT[meeting.status] ? (
        <Banner tone="warn">
          {STATUS_TEXT[meeting.status]}
          {meeting.progress > 0 && meeting.status !== "live" ? ` — ${meeting.progress}%` : ""}
        </Banner>
      ) : null}
      {meeting.status === "failed" && (
        <Card style={{ borderColor: "#fecaca" }}>
          <Text style={{ color: colors.danger, marginBottom: 10 }}>{meeting.error_message || "Processing failed."}</Text>
          {meeting.has_audio && <Button label="Retry transcription" variant="secondary" onPress={() => void run("Retry", async () => setMeeting(await meetingsApi.transcribe(meeting.id)))} />}
        </Card>
      )}
      {meeting.has_audio && (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Button label={status.playing ? "Pause" : "Play"} onPress={() => (status.playing ? player.pause() : player.play())} style={{ width: 96 }} />
            <View style={{ flex: 1 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" }}>
                <View style={{ height: 6, width: `${status.duration ? (status.currentTime / status.duration) * 100 : 0}%`, backgroundColor: colors.brand }} />
              </View>
              <Muted style={{ marginTop: 4, fontSize: 12 }}>
                {formatClock(status.currentTime * 1000)} / {formatClock((status.duration || meeting.duration_seconds) * 1000)}
              </Muted>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Button label="−10 s" variant="secondary" onPress={() => seek(Math.max(0, status.currentTime - 10) * 1000)} style={{ flex: 1, minHeight: 40 }} />
            <Button label="+10 s" variant="secondary" onPress={() => seek((status.currentTime + 10) * 1000)} style={{ flex: 1, minHeight: 40 }} />
          </View>
        </Card>
      )}
      <View style={{ flexDirection: "row", backgroundColor: "#e2e8f0", borderRadius: 12, padding: 4, marginBottom: 12 }}>
        {(["transcript", "notes"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center", backgroundColor: tab === t ? "#fff" : "transparent" }}>
            <Text style={{ fontWeight: "700", color: tab === t ? colors.ink : colors.muted }}>
              {t === "transcript" ? `Transcript (${meeting.segments.length})` : "Notes & export"}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "transcript" && (
        <TextInput placeholder="Search transcript…" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={[styles.input, { marginBottom: 10 }]} />
      )}
    </View>
  );

  if (tab === "notes") {
    return (
      <FlatList
        data={[0]}
        keyExtractor={() => "notes"}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={header}
        renderItem={() => (
          <NotesTab
            meeting={meeting}
            config={config}
            busy={busy}
            pending={summaryPending || meeting.status === "summarizing"}
            onSeek={(i) => seek(startOf(i))}
            onSummarize={(lang) =>
              void run("Notes", async () => {
                stamp.current = meeting.summary_generated_at;
                await meetingsApi.summarize(meeting.id, lang);
                setSummaryPending(true);
              })
            }
            onTranslate={(lang) => void run("Translate", async () => setMeeting(await meetingsApi.translate(meeting.id, lang)))}
            onToggle={(itemId, done) =>
              void run("Update", async () => {
                const item = await meetingsApi.updateActionItem(meeting.id, itemId, { done });
                setMeeting({ ...meeting, action_items: meeting.action_items.map((a) => (a.id === item.id ? item : a)) });
              })
            }
            onExport={(kind) =>
              void run("Export", () =>
                downloadAndShare(
                  meetingsApi.exportUrl(meeting.id, kind),
                  `${meeting.title.replace(/[^\w\- ]+/g, "").trim() || "meeting"}.${kind}`,
                  EXPORT_MIME[kind],
                ),
              )
            }
            onDelete={() =>
              Alert.alert("Delete meeting?", "The recording, transcript and notes are deleted permanently.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => void meetingsApi.remove(meeting.id).then(() => router.back()),
                },
              ])
            }
          />
        )}
      />
    );
  }

  return (
    <>
      <FlatList
        data={segments}
        keyExtractor={(s) => String(s.index)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={header}
        ListEmptyComponent={<Muted style={{ textAlign: "center" }}>{query ? "No matches." : "No transcript yet."}</Muted>}
        renderItem={({ item: s }) => (
          <Pressable
            onPress={() => seek(s.start_ms)}
            onLongPress={() => setEditing(s)}
            style={[styles.card, { marginBottom: 8, padding: 12 }, s.index === active && { backgroundColor: colors.brandSoft, borderColor: "#c7d2fe" }]}
            accessibilityHint="Tap to play from here, long-press to correct"
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.brand }}>
              {formatClock(s.start_ms)}
              {s.speaker ? ` · ${s.speaker}` : ""}
              {s.edited_at ? " · edited" : ""}
            </Text>
            <Text style={{ fontSize: 16, color: colors.ink, marginTop: 4, lineHeight: 23 }}>{s.original_text}</Text>
            {s.translated_text && s.translated_text !== s.original_text ? (
              <Text style={{ fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 20 }}>{s.translated_text}</Text>
            ) : null}
          </Pressable>
        )}
      />
      <EditModal
        segment={editing}
        onClose={() => setEditing(null)}
        onSave={async (original, translated) => {
          if (!editing) return;
          const seg = await meetingsApi.updateSegment(meeting.id, editing.index, { original_text: original, translated_text: translated });
          setMeeting({ ...meeting, segments: meeting.segments.map((x) => (x.index === seg.index ? seg : x)) });
          setEditing(null);
        }}
      />
    </>
  );
}

type EditProps = { segment: TranscriptSegment | null; onClose: () => void; onSave: (o: string, t: string) => Promise<void> };

function EditModal(props: EditProps) {
  return (
    <Modal visible={props.segment !== null} animationType="slide" transparent onRequestClose={props.onClose}>
      {/* Keyed so the form state resets for each segment. */}
      <EditForm key={props.segment?.index ?? -1} {...props} />
    </Modal>
  );
}

function EditForm({ segment, onClose, onSave }: EditProps) {
  const [original, setOriginal] = useState(segment?.original_text ?? "");
  const [translated, setTranslated] = useState(segment?.translated_text ?? "");
  const [error, setError] = useState("");
  return (
    <>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.4)" }}>
        <View style={{ backgroundColor: "#fff", padding: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 10 }}>
          <Text style={styles.label}>Correct segment {segment ? formatClock(segment.start_ms) : ""}</Text>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <TextInput value={original} onChangeText={setOriginal} multiline style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} accessibilityLabel="Original text" />
          {segment?.translated_text ? (
            <TextInput value={translated} onChangeText={setTranslated} multiline style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} accessibilityLabel="Translation" />
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label="Save"
              onPress={() => void onSave(original, translated).catch((e) => setError(e instanceof ApiError ? e.message : "Could not save"))}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </>
  );
}

function NotesTab(props: {
  meeting: MeetingDetail;
  config: MeetingConfig | null;
  busy: string;
  pending: boolean;
  onSeek: (segmentIndex: number) => void;
  onSummarize: (lang: string) => void;
  onTranslate: (lang: string) => void;
  onToggle: (itemId: number, done: boolean) => void;
  onExport: (kind: ExportKind) => void;
  onDelete: () => void;
}) {
  const { meeting, config } = props;
  const [lang, setLang] = useState<string>(meeting.summary_language);
  const notes = meeting.summary;
  const langChips = (value: string, onPick: (v: string) => void) => (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      {MEETING_LANGUAGES.map((l) => (
        <Pressable
          key={l.code}
          onPress={() => onPick(l.code)}
          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: value === l.code ? colors.brand : colors.line, backgroundColor: value === l.code ? colors.brandSoft : "#fff" }}
        >
          <Text style={{ fontWeight: "600", color: value === l.code ? colors.brand : colors.ink }}>{l.name}</Text>
        </Pressable>
      ))}
    </View>
  );
  const list = (title: string, items: NotePoint[] | undefined, empty = "None.") => (
    <View style={{ marginTop: 14 }}>
      <Text style={[styles.label, { color: colors.muted, fontSize: 12, textTransform: "uppercase" }]}>{title}</Text>
      {!items?.length ? <Muted>{empty}</Muted> : null}
      {items?.map((p, i) => (
        <Pressable key={i} onPress={() => p.segments[0] !== undefined && props.onSeek(p.segments[0])} style={{ paddingVertical: 4 }}>
          <Text style={{ color: colors.ink, lineHeight: 21 }}>
            • {p.text} <Text style={{ color: colors.brand, fontSize: 12 }}>{p.segments.map((s) => `#${s + 1}`).join(" ")}</Text>
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View>
      <Card>
        <Text style={styles.label}>AI meeting notes</Text>
        {!config?.summaries_enabled ? (
          <Muted>AI notes are not configured on the server (ANTHROPIC_API_KEY). Transcripts and exports still work.</Muted>
        ) : (
          <>
            {langChips(lang, setLang)}
            <Button
              label={props.pending ? "Writing notes…" : notes ? "Regenerate notes" : "Generate notes"}
              onPress={() => props.onSummarize(lang)}
              busy={props.busy === "Notes"}
              disabled={props.pending || meeting.segments.length === 0}
              style={{ marginTop: 12 }}
            />
          </>
        )}
        {meeting.summary_error && !props.pending ? <Text style={{ color: colors.danger, marginTop: 8 }}>Last attempt failed: {meeting.summary_error}</Text> : null}
        {notes ? (
          <>
            <Text style={{ marginTop: 14, color: colors.ink, lineHeight: 22 }}>{notes.summary}</Text>
            {list("Key discussion points", notes.key_points)}
            {list("Decisions", notes.decisions, "No explicit decisions.")}
            <View style={{ marginTop: 14 }}>
              <Text style={[styles.label, { color: colors.muted, fontSize: 12, textTransform: "uppercase" }]}>Action items</Text>
              {meeting.action_items.length === 0 ? <Muted>None stated.</Muted> : null}
              {meeting.action_items.map((a) => (
                <Pressable key={a.id} onPress={() => props.onToggle(a.id, !a.done)} style={{ flexDirection: "row", gap: 10, paddingVertical: 6 }} accessibilityRole="checkbox" accessibilityState={{ checked: a.done }}>
                  <Icon name={a.done ? "checkbox" : "square-outline"} size={22} color={a.done ? colors.accent : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: a.done ? colors.muted : colors.ink, textDecorationLine: a.done ? "line-through" : "none" }}>{a.text}</Text>
                    <Muted style={{ fontSize: 12 }}>
                      {a.owner_name ? `Owner: ${a.owner_name}` : "Owner: not stated"} · {a.deadline ? `Due: ${a.deadline}` : "No deadline stated"}
                    </Muted>
                  </View>
                </Pressable>
              ))}
            </View>
            {list("Open questions & follow-ups", notes.open_questions)}
            <Muted style={{ marginTop: 12, fontSize: 12 }}>Owners and deadlines appear only when stated in the meeting. AI notes can be wrong.</Muted>
          </>
        ) : null}
      </Card>
      <Card>
        <Text style={styles.label}>Translate transcript</Text>
        {langChips(meeting.translation_language, (l) => props.onTranslate(l))}
        <Muted style={{ marginTop: 8, fontSize: 12 }}>{props.busy === "Translate" ? "Translating…" : "The original text is kept; translation is stored separately."}</Muted>
      </Card>
      <Card>
        <Text style={styles.label}>Export</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {(["txt", "docx", "csv", "json", "srt", "vtt"] as const).map((k) => (
            <Button key={k} label={k === "docx" ? "Word" : k.toUpperCase()} variant="secondary" onPress={() => props.onExport(k)} busy={props.busy === "Export"} disabled={meeting.segments.length === 0} style={{ flexBasis: "30%", flexGrow: 1, minHeight: 40 }} />
          ))}
        </View>
        <Muted style={{ marginTop: 8, fontSize: 12 }}>Opens the share sheet: save to Files, or send by WhatsApp or email. For PDF, use the web app’s print view.</Muted>
      </Card>
      <Button label="Delete meeting" variant="danger" onPress={props.onDelete} />
    </View>
  );
}
