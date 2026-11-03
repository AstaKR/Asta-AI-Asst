import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, meetingsApi } from "../api";
import { ErrorBanner, Layout } from "../components/Layout";
import { ExportControls } from "../components/meetings/ExportControls";
import { MeetingSummary } from "../components/meetings/MeetingSummary";
import { TranscriptPanel } from "../components/meetings/TranscriptPanel";
import { MEETING_LANGUAGES, activeSegmentIndex, formatClock, isProcessing, meetingLanguageName } from "../lib/meetings";
import type { MeetingConfig, MeetingDetail } from "../types";

const STATUS_TEXT: Record<string, string> = {
  queued: "Waiting to be processed…",
  transcribing: "Transcribing",
  translating: "Translating",
  summarizing: "Writing notes",
  live: "Live session in progress",
  failed: "Processing failed",
};

export function MeetingDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [config, setConfig] = useState<MeetingConfig | null>(null);
  const [error, setError] = useState("");
  const [summaryPending, setSummaryPending] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [translateTo, setTranslateTo] = useState("");
  const [translating, setTranslating] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const summaryStamp = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await meetingsApi.get(id);
      setMeeting(m);
      if (summaryPending && (m.summary_generated_at !== summaryStamp.current || m.summary_error)) setSummaryPending(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "Meeting not found." : "Could not load the meeting.");
    }
  }, [id, summaryPending]);

  useEffect(() => {
    void load();
    meetingsApi.config().then(setConfig).catch(() => undefined);
  }, [load]);

  // Poll while the server is working on it.
  const busy = meeting ? isProcessing(meeting.status) || meeting.status === "live" || summaryPending : false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  const seek = (ms: number) => {
    if (!audio.current) return;
    audio.current.currentTime = ms / 1000;
    void audio.current.play().catch(() => undefined);
  };

  async function retry() {
    try {
      setMeeting(await meetingsApi.transcribe(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not restart");
    }
  }

  async function translate() {
    if (!translateTo) return;
    setTranslating(true);
    try {
      setMeeting(await meetingsApi.translate(id, translateTo));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this meeting, its recording, transcript and notes permanently?")) return;
    await meetingsApi.remove(id).catch(() => undefined);
    navigate("/meetings");
  }

  if (!meeting) {
    return (
      <Layout wide>
        {error ? <ErrorBanner message={error} /> : <p className="text-sm text-muted">Loading…</p>}
      </Layout>
    );
  }

  const active = activeSegmentIndex(meeting.segments, timeMs);
  return (
    <Layout wide>
      <Link to="/meetings" className="text-sm text-brand hover:underline">
        ← All meetings
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meeting.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {new Date(meeting.recorded_at).toLocaleString()} · {formatClock(meeting.duration_seconds * 1000)} ·{" "}
            {meetingLanguageName(meeting.spoken_language)}
            {meeting.translation_language && ` → ${meetingLanguageName(meeting.translation_language)}`}
            {meeting.transcription_engine && ` · ${meeting.transcription_engine}`}
          </p>
        </div>
        <ExportControls meetingId={meeting.id} disabled={meeting.segments.length === 0} timed={meeting.segments.some((s) => s.end_ms > s.start_ms)} />
      </div>

      <div className="mt-4 space-y-3">
        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        {(isProcessing(meeting.status) || meeting.status === "live") && (
          <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
            {STATUS_TEXT[meeting.status]}
            {meeting.progress > 0 && meeting.status !== "live" && ` — ${meeting.progress}%`}
            {meeting.status === "queued" && " (the job runner must be running: manage.py process_meetings)"}
          </div>
        )}
        {meeting.status === "failed" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            <span>{meeting.error_message || "Processing failed."}</span>
            {meeting.has_audio && (
              <button className="btn-secondary py-1.5" onClick={() => void retry()}>
                Retry transcription
              </button>
            )}
          </div>
        )}
      </div>

      {meeting.has_audio && (
        <div className="card mt-4 p-4">
          <audio ref={audio} controls preload="metadata" src={meetingsApi.audioUrl(meeting.id)} onTimeUpdate={(e) => setTimeMs(e.currentTarget.currentTime * 1000)} className="w-full">
            Your browser cannot play this audio.
          </audio>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_400px]">
        <TranscriptPanel
          meetingId={meeting.id}
          segments={meeting.segments}
          translationLanguage={meeting.translation_language}
          activeIndex={active}
          onSeek={seek}
          onSegmentSaved={(seg) => setMeeting({ ...meeting, segments: meeting.segments.map((s) => (s.index === seg.index ? seg : s)) })}
        />
        <div className="space-y-4">
          {config && (
            <MeetingSummary
              meeting={meeting}
              config={config}
              pending={summaryPending || meeting.status === "summarizing"}
              onRequested={() => {
                summaryStamp.current = meeting.summary_generated_at;
                setSummaryPending(true);
              }}
              onSeek={seek}
              onActionItem={(item) => setMeeting({ ...meeting, action_items: meeting.action_items.map((a) => (a.id === item.id ? item : a)) })}
            />
          )}
          <section className="card space-y-3 p-5">
            <h2 className="font-semibold">Translation</h2>
            <div className="flex gap-2">
              <select className="field" value={translateTo} onChange={(e) => setTranslateTo(e.target.value)} aria-label="Translate into">
                <option value="">Translate transcript into…</option>
                {MEETING_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary" disabled={!translateTo || translating || meeting.segments.length === 0} onClick={() => void translate()}>
                {translating ? "Translating…" : "Translate"}
              </button>
            </div>
            <p className="text-xs text-muted">Original text is kept; the translation is stored separately. Uses Sarvam translation credits.</p>
          </section>
          <section className="card space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Details</h2>
            <p className="text-muted">
              Speech recognised {Math.round(meeting.stt_seconds)} s · translated {meeting.translate_chars} chars
              {meeting.audio_original_name && ` · file ${meeting.audio_original_name}`}
            </p>
            <button className="text-sm font-medium text-danger hover:underline" onClick={() => void remove()}>
              Delete meeting
            </button>
          </section>
        </div>
      </div>
    </Layout>
  );
}
