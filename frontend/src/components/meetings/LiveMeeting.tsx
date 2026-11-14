import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, meetingsApi } from "../../api";
import { formatClock, pickRecorderFormat } from "../../lib/meetings";
import type { MeetingConfig, MeetingDetail, TranscriptSegment } from "../../types";
import { ErrorBanner } from "../Layout";
import { CONSENT_TEXT, MeetingSetupFields, defaultSetup, type MeetingSetup } from "./MeetingSetupFields";

const CHUNK_SECONDS = 40; // each chunk is a complete, separately decodable file
const NOTES_EVERY_SECONDS = 90;
const SPEAKER_COLORS = ["text-brand", "text-accent", "text-warn", "text-neon", "text-danger"];

/**
 * In-person group meeting: this device records the room and sends short chunks while the meeting runs. Each
 * chunk comes back as transcript lines labelled "Speaker 1", "Speaker 2"... and the notes refresh every minute
 * or two. No video-call service is involved.
 */
export function LiveMeeting({ config }: { config: MeetingConfig }) {
  const [setup, setSetup] = useState<MeetingSetup>({
    ...defaultSetup(),
    spoken_language: "auto",
    translation_language: "",
  });
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
    return <LiveSession meetingId={meetingId} maxSeconds={config.max_duration_seconds} summariesEnabled={config.summaries_enabled} />;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <MeetingSetupFields value={setup} onChange={setSetup} allowAuto showTranslation={false} consentText={CONSENT_TEXT} />
      <p className="text-sm text-muted">
        Put this device in the middle of the table. The transcript shows who spoke, and notes appear while you talk.
      </p>
      <button className="btn-primary" disabled={busy || !setup.consent || !setup.title.trim()} onClick={() => void start()}>
        {busy ? "Starting…" : "Start meeting"}
      </button>
    </div>
  );
}

function LiveSession({ meetingId, maxSeconds, summariesEnabled }: { meetingId: string; maxSeconds: number; summariesEnabled: boolean }) {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [notes, setNotes] = useState<MeetingDetail | null>(null);
  const [phase, setPhase] = useState<"live" | "saving">("live");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
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
        form.append(
          "file",
          new File([blob], `chunk.${format.current?.ext ?? "webm"}`, {
            type: blob.type,
          }),
        );
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
    const rec = new MediaRecorder(s, {
      mimeType: format.current.mime,
      audioBitsPerSecond: 64000,
    });
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
      .getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((s) => {
        stream.current = s;
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
      if (!(err instanceof ApiError && err.status === 400))
        setError(err instanceof ApiError ? err.message : "Could not refresh the notes.");
    }
  }

  useEffect(() => {
    if (phase === "live" && elapsed > 0 && elapsed - notesAt.current >= NOTES_EVERY_SECONDS && pending === 0) {
      notesAt.current = elapsed;
      void refreshNotes();
    }
  }, [elapsed, pending, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
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

  const colors = new Map<string, string>();
  const colorOf = (speaker: string) => {
    if (!colors.has(speaker)) colors.set(speaker, SPEAKER_COLORS[colors.size % SPEAKER_COLORS.length]);
    return colors.get(speaker)!;
  };
  const summary = notes?.summary;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="chip bg-danger-soft text-danger">
          <span className="h-2 w-2 animate-pulse rounded-full bg-current" /> Recording
        </span>
        <span className="chip bg-subtle font-mono text-ink">
          {formatClock(elapsed * 1000)} / {formatClock(maxSeconds * 1000)}
        </span>
        {pending > 0 && <span className="chip bg-brand-soft text-brand">Transcribing…</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section aria-label="Transcript" className="max-h-[26rem] min-h-40 space-y-3 overflow-y-auto rounded-xl bg-subtle p-4">
          {segments.length === 0 && (
            <p className="text-sm text-muted">Start talking. Lines appear here about {CHUNK_SECONDS} seconds after you speak.</p>
          )}
          {segments.map((s) => (
            <p key={s.index} className="text-[15px] leading-snug">
              <span className={`mr-2 font-mono text-xs font-semibold ${colorOf(s.speaker || "?")}`}>{s.speaker || "Speaker"}</span>
              {s.original_text}
            </p>
          ))}
          <div ref={endRef} />
        </section>

        <section aria-label="Live notes" className="space-y-3 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Live notes</p>
            <button
              className="text-xs text-brand underline"
              disabled={!summariesEnabled || !segments.length}
              onClick={() => void refreshNotes()}
            >
              Refresh now
            </button>
          </div>
          {!summariesEnabled && <p className="text-sm text-muted">AI notes are not set up on this server.</p>}
          {summariesEnabled && !summary && <p className="text-sm text-muted">Notes appear after the first minute or two of talking.</p>}
          {summary && (
            <div className="space-y-3 text-sm">
              <p>{summary.summary}</p>
              {summary.decisions.length > 0 && <NoteList title="Decisions" items={summary.decisions.map((d) => d.text)} />}
              {notes.action_items.length > 0 && (
                <NoteList
                  title="Action items"
                  items={notes.action_items.map((a) => (a.owner_name ? `${a.text} — ${a.owner_name}` : a.text))}
                />
              )}
              {summary.open_questions.length > 0 && <NoteList title="Open questions" items={summary.open_questions.map((q) => q.text)} />}
            </div>
          )}
        </section>
      </div>

      <button className="btn-danger" disabled={phase === "saving"} onClick={() => void finish()}>
        {phase === "saving" ? "Saving…" : "End meeting and save"}
      </button>
    </div>
  );
}

function NoteList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-wide text-muted uppercase">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
