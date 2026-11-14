import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, meetingsApi } from "../../api";
import { formatClock, pickRecorderFormat } from "../../lib/meetings";
import type { MeetingConfig, MeetingDetail, TranscriptSegment } from "../../types";
import { ErrorBanner } from "../Layout";
import { CONSENT_TEXT, MeetingSetupFields, defaultSetup, type MeetingSetup } from "./MeetingSetupFields";
import { MicOrb } from "./MicOrb";
import { RoundTable, SEAT_COLORS, type Seat } from "./RoundTable";

const CHUNK_SECONDS = 40; // each chunk is a complete, separately decodable file
const NOTES_EVERY_SECONDS = 90;
type NotesTab = "summary" | "decisions" | "actions" | "questions";

/**
 * In-person group meeting: this device records the room and sends short chunks while the meeting runs. Each chunk
 * comes back as transcript lines labelled "Speaker 1", "Speaker 2"... and the notes refresh every minute or two.
 * No video-call service is involved.
 */
export function LiveMeeting({ config }: { config: MeetingConfig }) {
  const [setup, setSetup] = useState<MeetingSetup>({ ...defaultSetup(), spoken_language: "auto", translation_language: "" });
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await meetingsApi.startLive({
        title: setup.title,
        spoken_language: setup.spoken_language,
        translation_language: "",
        voice_playback: false,
        consent: setup.consent,
      });
      setMeetingId(res.meeting.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the session");
    } finally {
      setBusy(false);
    }
  }

  if (meetingId)
    return <LiveSession title={setup.title} meetingId={meetingId} maxSeconds={config.max_duration_seconds} summariesEnabled={config.summaries_enabled} />;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="grid items-center gap-6 sm:grid-cols-[1fr_200px]">
        <div className="space-y-4">
          <MeetingSetupFields value={setup} onChange={setSetup} allowAuto showTranslation={false} consentText={CONSENT_TEXT} />
          <button className="btn-primary" disabled={busy || !setup.consent || !setup.title.trim()} onClick={() => void start()}>
            {busy ? "Starting…" : "Start meeting"}
          </button>
        </div>
        <div className="hidden sm:block">
          <MicOrb stream={null} />
          <p className="mt-2 text-center text-xs text-muted">Put this device in the middle of the table.</p>
        </div>
      </div>
    </div>
  );
}

function LiveSession({ title, meetingId, maxSeconds, summariesEnabled }: { title: string; meetingId: string; maxSeconds: number; summariesEnabled: boolean }) {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [notes, setNotes] = useState<MeetingDetail | null>(null);
  const [tab, setTab] = useState<NotesTab>("summary");
  const [phase, setPhase] = useState<"live" | "saving">("live");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const format = useRef(pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m)));
  const queue = useRef<Promise<void>>(Promise.resolve());
  const notesAt = useRef(0);
  const segCount = useRef(0);
  const stopped = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  function upload(blob: Blob) {
    if (!blob.size) return;
    setPending((n) => n + 1);
    // One upload at a time, in order: the server numbers lines by arrival.
    queue.current = queue.current.then(async () => {
      try {
        const form = new FormData();
        form.append("file", new File([blob], `chunk.${format.current?.ext ?? "webm"}`, { type: blob.type }));
        const res = await meetingsApi.sendChunk(meetingId, form);
        segCount.current += res.segments.length;
        setSegments((s) => [...s, ...res.segments]);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "A piece of audio could not be transcribed.");
      } finally {
        setPending((n) => n - 1);
      }
    });
  }

  function startChunk() {
    const s = stream.current;
    if (!s || !format.current || stopped.current) return;
    const parts: Blob[] = [];
    const rec = new MediaRecorder(s, { mimeType: format.current.mime, audioBitsPerSecond: 64000 });
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      upload(new Blob(parts, { type: format.current!.mime }));
      if (!stopped.current) startChunk();
    };
    rec.start();
    recorder.current = rec;
    window.setTimeout(() => rec.state === "recording" && rec.stop(), CHUNK_SECONDS * 1000);
  }

  useEffect(() => {
    if (!format.current) {
      setError("This browser cannot record audio.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        stream.current = s;
        setMicStream(s);
        startChunk();
      })
      .catch(() => setError("Microphone access was blocked. Allow it in the browser and start again."));
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      window.clearInterval(tick);
      stopped.current = true;
      if (recorder.current?.state === "recording") recorder.current.onstop = null;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshNotes() {
    if (!summariesEnabled || !segCount.current) return;
    try {
      setNotes(await meetingsApi.liveNotes(meetingId));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400)) setError(err instanceof ApiError ? err.message : "Could not refresh the notes.");
    }
  }

  useEffect(() => {
    if (phase === "live" && elapsed > 0 && elapsed - notesAt.current >= NOTES_EVERY_SECONDS && pending === 0) {
      notesAt.current = elapsed;
      void refreshNotes();
    }
  }, [elapsed, pending, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [segments.length]);

  useEffect(() => {
    if (elapsed >= maxSeconds - 2 && phase === "live") void finish();
  }, [elapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    setPhase("saving");
    stopped.current = true;
    const rec = recorder.current;
    if (rec && rec.state === "recording") rec.stop(); // its onstop uploads the last piece
    stream.current?.getTracks().forEach((t) => t.stop());
    await new Promise((r) => setTimeout(r, 300));
    await queue.current;
    try {
      await meetingsApi.finishLive(meetingId);
      navigate(`/meetings/${meetingId}`);
    } catch (err) {
      setPhase("live");
      setError(err instanceof ApiError ? err.message : "Could not finish the meeting. Try again.");
    }
  }

  // Who is at the table: in order of first appearance, with a word count; the last speaker is highlighted.
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
  const colorOf = (speaker: string) => seats.find((s) => s.name === (speaker || "Speaker"))?.color ?? SEAT_COLORS[0];

  const summary = notes?.summary;
  const tabs: { key: NotesTab; label: string; count?: number }[] = [
    { key: "summary", label: "Summary" },
    { key: "decisions", label: "Decisions", count: summary?.decisions.length },
    { key: "actions", label: "Actions", count: notes?.action_items.length },
    { key: "questions", label: "Open", count: summary?.open_questions.length },
  ];

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">// live meeting</p>
          <h2 className="truncate text-xl font-bold">{title}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="chip bg-danger-soft text-danger">
            <span className="h-2 w-2 animate-pulse rounded-full bg-current" /> REC
          </span>
          <span className="chip bg-subtle font-mono text-ink">
            {formatClock(elapsed * 1000)} / {formatClock(maxSeconds * 1000)}
          </span>
          {pending > 0 && (
            <span className="chip bg-brand-soft text-brand">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> Transcribing
            </span>
          )}
        </div>
      </div>

      <RoundTable seats={seats}>
        <MicOrb stream={micStream} paused={phase === "saving"} />
      </RoundTable>
      {seats.length === 0 && (
        <p className="text-center text-sm text-muted">Start talking. Speakers take their seats here about {CHUNK_SECONDS} seconds after they speak.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section aria-label="Transcript" className="max-h-[28rem] min-h-44 space-y-2.5 overflow-y-auto rounded-2xl bg-subtle p-4">
          {segments.length === 0 && <p className="text-sm text-muted">The conversation appears here, line by line.</p>}
          {segments.map((s) => (
            <div key={s.index} className="animate-rise rounded-xl border-l-[3px] bg-surface/60 py-2 pr-3 pl-3" style={{ borderLeftColor: colorOf(s.speaker) }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] font-semibold tracking-wide uppercase" style={{ color: colorOf(s.speaker) }}>
                  {s.speaker || "Speaker"}
                </span>
                <span className="font-mono text-[10px] text-muted">{formatClock(s.start_ms)}</span>
              </div>
              <p className="mt-0.5 text-[15px] leading-snug">{s.original_text}</p>
            </div>
          ))}
          <div ref={endRef} />
        </section>

        <section aria-label="Live notes" className="card glow-border space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Live notes</p>
            <button className="text-xs text-brand underline" disabled={!summariesEnabled || !segments.length} onClick={() => void refreshNotes()}>
              Refresh now
            </button>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-subtle p-1 text-xs font-medium" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-lg px-2.5 py-1.5 whitespace-nowrap transition-colors ${tab === t.key ? "bg-brand-soft text-ink" : "text-muted"}`}
              >
                {t.label}
                {t.count ? <span className="ml-1 font-mono text-[10px] text-neon">{t.count}</span> : null}
              </button>
            ))}
          </div>
          <div key={tab} className="animate-rise min-h-24 text-sm leading-relaxed">
            {!summariesEnabled && <p className="text-muted">AI notes are not set up on this server.</p>}
            {summariesEnabled && !summary && <p className="text-muted">Notes appear after the first minute or two of talking.</p>}
            {summary && tab === "summary" && <p>{summary.summary}</p>}
            {summary && tab === "decisions" && <Items items={summary.decisions.map((d) => d.text)} empty="No decisions yet." />}
            {summary && tab === "actions" && (
              <Items
                items={(notes?.action_items ?? []).map((a) => [a.text, a.owner_name, a.deadline].filter(Boolean).join(" — "))}
                empty="No action items yet."
              />
            )}
            {summary && tab === "questions" && <Items items={summary.open_questions.map((q) => q.text)} empty="No open questions." />}
          </div>
        </section>
      </div>

      <button className="btn-danger" disabled={phase === "saving"} onClick={() => void finish()}>
        {phase === "saving" ? "Saving…" : "End meeting and save"}
      </button>
    </div>
  );
}

function Items({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-neon" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
