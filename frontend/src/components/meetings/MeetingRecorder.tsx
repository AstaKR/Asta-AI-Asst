import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, meetingsApi } from "../../api";
import { formatClock, pickRecorderFormat } from "../../lib/meetings";
import type { MeetingConfig } from "../../types";
import { ErrorBanner } from "../Layout";
import { CONSENT_TEXT, MeetingSetupFields, defaultSetup, type MeetingSetup } from "./MeetingSetupFields";

type State = "idle" | "recording" | "paused" | "stopped" | "uploading";

/** Records the browser microphone (this device only — not system audio or phone calls) and uploads it. */
export function MeetingRecorder({ config }: { config: MeetingConfig }) {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<MeetingSetup>({ ...defaultSetup(), spoken_language: "auto" });
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const format = useRef<{ mime: string; ext: string } | null>(null);
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  useEffect(() => {
    if (state === "recording" && elapsed >= config.max_duration_seconds) stop();
  }, [elapsed, state, config.max_duration_seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError("");
    format.current = pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m));
    if (!format.current) return setError("This browser cannot record audio in a supported format.");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return setError("Microphone access was blocked. Allow the microphone for this site and try again.");
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current, { mimeType: format.current.mime, audioBitsPerSecond: 64000 });
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      setBlob(new Blob(chunks.current, { type: format.current!.mime }));
      stream.current?.getTracks().forEach((t) => t.stop());
      setState("stopped");
    };
    rec.start(1000);
    recorder.current = rec;
    setElapsed(0);
    setState("recording");
  }

  function pause() {
    recorder.current?.pause();
    setState("paused");
  }

  function resume() {
    recorder.current?.resume();
    setState("recording");
  }

  function stop() {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  async function upload() {
    if (!blob || !format.current) return;
    const form = new FormData();
    form.append("file", new File([blob], `recording.${format.current.ext}`, { type: format.current.mime }));
    form.append("title", setup.title);
    form.append("source", "recording");
    form.append("spoken_language", setup.spoken_language);
    form.append("translation_language", setup.translation_language);
    form.append("consent", String(setup.consent));
    setState("uploading");
    try {
      const meeting = await meetingsApi.upload(form, setProgress);
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setState("stopped");
      setError(err instanceof ApiError ? err.message : "Upload failed");
    }
  }

  if (!supported) return <ErrorBanner message="This browser does not support audio recording. Use Chrome, Edge, Firefox or Safari 14.1+." />;

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <MeetingSetupFields value={setup} onChange={setSetup} consentText={CONSENT_TEXT} />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
        <span className={`chip ${state === "recording" ? "bg-danger-soft text-danger" : "bg-subtle text-muted"}`}>
          <span className="h-2 w-2 rounded-full bg-current" />
          {state === "recording" ? "Recording" : state === "paused" ? "Paused" : state === "stopped" ? "Stopped" : state === "uploading" ? "Uploading" : "Not recording"}
        </span>
        <span className="font-mono text-lg">{formatClock(elapsed * 1000)}</span>
        <div className="flex-1" />
        {state === "idle" && (
          <button className="btn-primary" disabled={!setup.consent || !setup.title.trim()} onClick={() => void start()}>
            Start recording
          </button>
        )}
        {state === "recording" && (
          <>
            <button className="btn-secondary" onClick={pause}>
              Pause
            </button>
            <button className="btn-danger" onClick={stop}>
              Stop
            </button>
          </>
        )}
        {state === "paused" && (
          <>
            <button className="btn-secondary" onClick={resume}>
              Resume
            </button>
            <button className="btn-danger" onClick={stop}>
              Stop
            </button>
          </>
        )}
        {state === "stopped" && blob && (
          <>
            <a className="btn-secondary" href={URL.createObjectURL(blob)} download={`recording.${format.current?.ext}`}>
              Save copy
            </a>
            <button className="btn-primary" onClick={() => void upload()} disabled={!setup.consent}>
              Upload and transcribe
            </button>
          </>
        )}
        {state === "uploading" && <span className="text-sm text-muted">Uploading {Math.round(progress * 100)}%…</span>}
      </div>
      <p className="text-xs text-muted">
        Records this device’s microphone only. It does not capture computer system audio, other apps, or mobile phone calls. For
        phone calls, use a translated call in this app.
      </p>
    </div>
  );
}
