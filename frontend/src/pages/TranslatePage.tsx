import { useEffect, useRef, useState } from "react";

import { ApiError, quickApi, type AICapabilities, type QuickResult } from "../api";
import { CheckIcon, CopyIcon, MicIcon, PauseIcon, PlayIcon, SpeakerIcon, StopIcon, SwapIcon, TrashIcon } from "../components/Icons";
import { ErrorBanner, Layout, PageHeader } from "../components/Layout";
import { MEETING_LANGUAGES, pickRecorderFormat } from "../lib/meetings";

const MAX_CHARS = 1000; // QUICK_MAX_TEXT_CHARS on the server
const MAX_RECORD_SECONDS = 30; // QUICK_MAX_SPEECH_SECONDS on the server
type Busy = "" | "translate" | "listen" | "speech";
type Playback = "idle" | "playing" | "paused";

function LanguageSelect({ id, value, onChange, allowDetect }: { id: string; value: string; onChange: (v: string) => void; allowDetect?: boolean }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowDetect && <option value="auto">Detect language (speech)</option>}
      {MEETING_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name} · {l.native}
        </option>
      ))}
    </select>
  );
}

function EngineNote({ caps }: { caps: AICapabilities | null }) {
  if (!caps) return null;
  const local = caps.translate.engine === "local";
  const notReady = [caps.translate, caps.stt, caps.tts].some((e) => !e.ready);
  return (
    <p className="text-xs text-muted">
      {local ? "Free local AI on this server — your text and voice are not sent to an outside AI provider." : "Translated by Sarvam AI."}
      {notReady && " Some features are not set up yet on this server."}
    </p>
  );
}

/** Text and voice translation between Tamil, Hindi and English, with spoken output. */
export function TranslatePage() {
  const [source, setSource] = useState("en");
  const [target, setTarget] = useState("ta");
  const [text, setText] = useState("");
  const [result, setResult] = useState<QuickResult | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playback, setPlayback] = useState<Playback>("idle");
  const [caps, setCaps] = useState<AICapabilities | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const canRecord = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    quickApi.capabilities().then(setCaps).catch(() => undefined);
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      audio.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_RECORD_SECONDS) recorder.current?.stop();
  }, [recording, seconds]);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  function loadAudio(r: QuickResult) {
    audio.current?.pause();
    audio.current = null;
    setPlayback("idle");
    if (!r.audio) return;
    const el = new Audio(`data:${r.audio_mime ?? "audio/wav"};base64,${r.audio}`);
    el.onended = () => setPlayback("idle");
    el.onpause = () => setPlayback((p) => (p === "playing" && !el.ended ? "paused" : p));
    audio.current = el;
    void el.play().then(() => setPlayback("playing"));
  }

  async function translate(speak = false) {
    const trimmed = text.trim();
    if (!trimmed) return setError("Type or speak something to translate.");
    if (source === "auto") return setError("Choose the language of the typed text.");
    setError("");
    setBusy(speak ? "listen" : "translate");
    try {
      const r = await quickApi.text({ text: trimmed, source_language: source, target_language: target, speak });
      setResult(r);
      if (speak) loadAudio(r);
    } catch (err) {
      fail(err, "Translation failed. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function listen() {
    if (result?.audio && result.translation && audio.current) {
      audio.current.currentTime = 0;
      await audio.current.play();
      return setPlayback("playing");
    }
    await translate(true);
  }

  function pause() {
    audio.current?.pause();
    setPlayback("paused");
  }

  function resume() {
    void audio.current?.play().then(() => setPlayback("playing"));
  }

  function stopAudio() {
    if (!audio.current) return;
    audio.current.pause();
    audio.current.currentTime = 0;
    setPlayback("idle");
  }

  async function startRecording() {
    setError("");
    const format = pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m));
    if (!format) return setError("This browser cannot record audio in a supported format.");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return setError("Microphone access was blocked. Allow the microphone for this site and try again.");
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream.current, { mimeType: format.mime });
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onerror = () => setError("Recording failed. Check your microphone.");
    rec.onstop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      setRecording(false);
      const blob = new Blob(chunks.current, { type: format.mime });
      if (blob.size) void sendSpeech(blob, `speech.${format.ext}`);
    };
    rec.start();
    recorder.current = rec;
    setSeconds(0);
    setRecording(true);
  }

  async function sendSpeech(blob: Blob, name: string) {
    setBusy("speech");
    try {
      const r = await quickApi.speech(blob, name, { source_language: source, target_language: target, speak: false });
      setText(r.original);
      setSource(r.source_language);
      setResult(r);
    } catch (err) {
      fail(err, "Could not recognise the speech.");
    } finally {
      setBusy("");
    }
  }

  function swap() {
    if (source === "auto") return;
    setSource(target);
    setTarget(source);
    if (result?.translation) setText(result.translation);
    setResult(null);
    stopAudio();
  }

  function clear() {
    setText("");
    setResult(null);
    setError("");
    stopAudio();
    audio.current = null;
  }

  async function copy() {
    if (!result?.translation) return;
    try {
      await navigator.clipboard.writeText(result.translation);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copying is blocked in this browser. Select the text and copy it instead.");
    }
  }

  const sameLanguage = source === target;
  const over = text.length > MAX_CHARS;

  return (
    <Layout wide>
      <PageHeader eyebrow="Tools" title="Translate" description="Type or speak in Tamil, Hindi or English and hear the translation." />
      <EngineNote caps={caps} />
      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} onDismiss={() => setError("")} />
        </div>
      )}

      <div className="mt-4 grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <LanguageSelect id="from" value={source} onChange={setSource} allowDetect />
        </div>
        <button type="button" className="btn-secondary h-[42px]" onClick={swap} disabled={source === "auto"} aria-label="Swap languages" title="Swap languages">
          <SwapIcon />
        </button>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <LanguageSelect id="to" value={target} onChange={setTarget} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card flex flex-col p-4" aria-label="Original">
          <textarea
            className="field min-h-48 flex-1 resize-y text-base"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={recording ? "Listening…" : "Type here, or press the microphone and speak"}
            aria-label="Text to translate"
            lang={source === "auto" ? undefined : source}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={() => void translate()} disabled={Boolean(busy) || recording || !text.trim() || over || sameLanguage}>
              {busy === "translate" ? "Translating…" : "Translate"}
            </button>
            {canRecord &&
              (recording ? (
                <button className="btn-danger" onClick={() => recorder.current?.stop()}>
                  <StopIcon /> Stop · {seconds}s
                </button>
              ) : (
                <button className="btn-secondary" onClick={() => void startRecording()} disabled={Boolean(busy)}>
                  <MicIcon /> {busy === "speech" ? "Recognising…" : "Speak"}
                </button>
              ))}
            <button className="btn-ghost" onClick={clear} disabled={!text && !result} aria-label="Clear">
              <TrashIcon /> Clear
            </button>
            <span className={`ml-auto text-xs ${over ? "text-danger" : "text-muted"}`}>
              {text.length} / {MAX_CHARS}
            </span>
          </div>
          {sameLanguage && <p className="mt-2 text-xs text-muted">Choose two different languages.</p>}
          {recording && <p className="mt-2 text-xs text-muted">Speak up to {MAX_RECORD_SECONDS} seconds, then press Stop.</p>}
        </section>

        <section className="card flex flex-col p-4" aria-label="Translation" aria-live="polite" aria-busy={busy === "translate" || busy === "speech"}>
          <div className="min-h-48 flex-1 rounded-xl bg-subtle px-3.5 py-2.5 text-base whitespace-pre-wrap" lang={result?.target_language}>
            {busy === "translate" || busy === "speech" ? (
              <span className="text-muted">Working…</span>
            ) : result?.translation ? (
              result.translation
            ) : (
              <span className="text-muted">The translation appears here.</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {playback === "playing" ? (
              <button className="btn-secondary" onClick={pause}>
                <PauseIcon /> Pause
              </button>
            ) : playback === "paused" ? (
              <button className="btn-secondary" onClick={resume}>
                <PlayIcon /> Resume
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => void listen()} disabled={Boolean(busy) || !text.trim() || sameLanguage}>
                <SpeakerIcon /> {busy === "listen" ? "Preparing voice…" : result?.audio ? "Play again" : "Listen"}
              </button>
            )}
            {playback !== "idle" && (
              <button className="btn-ghost" onClick={stopAudio}>
                <StopIcon /> Stop
              </button>
            )}
            <button className="btn-ghost" onClick={() => void copy()} disabled={!result?.translation}>
              {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">AI translations can be wrong — check important details.</p>
        </section>
      </div>
    </Layout>
  );
}
