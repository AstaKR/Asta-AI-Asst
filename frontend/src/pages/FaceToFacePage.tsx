import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, quickApi, type QuickResult } from "../api";
import { MicIcon, SpeakerIcon, SwapIcon } from "../components/Icons";
import { ErrorBanner, Layout, PageHeader } from "../components/Layout";
import { pickRecorderFormat } from "../lib/meetings";
import { createTurnDetector, levelDb } from "../lib/vad";

type Side = "a" | "b";
type Mode = "tap" | "auto";
const other = (s: Side): Side => (s === "a" ? "b" : "a");
const LANGS = [
  { code: "ta", native: "தமிழ்", name: "Tamil" },
  { code: "hi", native: "हिन्दी", name: "Hindi" },
  { code: "en", native: "English", name: "English" },
];
const MAX_HOLD_MS = 30000;

/**
 * Face-to-face conversation with one device between two people (like an interpreter).
 * Each panel shows the latest sentence in its own language: what that person said, or the translation of what the
 * other said (tap the speaker to hear it again). Tap the mic to speak and tap again to send. Hands-free: the device
 * listens, works out who spoke from the language, and speaks the translation to the other person.
 */
export function FaceToFacePage() {
  const [lang, setLang] = useState<Record<Side, string>>({ a: "ta", b: "hi" });
  const [mode, setMode] = useState<Mode>("tap");
  const [speak, setSpeak] = useState(true);
  const [table, setTable] = useState(false); // person A sits opposite: their side is upside down
  const [last, setLast] = useState<{ speaker: Side; result: QuickResult } | null>(null);
  const [recording, setRecording] = useState<Side | "auto" | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false); // hands-free armed
  const [level, setLevel] = useState(-100);
  const [error, setError] = useState("");

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStop = useRef<(() => Promise<void>) | null>(null);
  const loop = useRef<{ stop: () => void } | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const speakRef = useRef(speak);
  speakRef.current = speak;

  const format = typeof MediaRecorder !== "undefined" ? pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m)) : null;

  const releaseMic = useCallback(() => {
    loop.current?.stop();
    loop.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => () => {
    releaseMic();
    player.current?.pause();
  }, [releaseMic]);

  async function openMic(): Promise<MediaStream | null> {
    if (stream.current) return stream.current;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return stream.current;
    } catch {
      setError("Microphone access was blocked. Allow the microphone for this site and try again.");
      return null;
    }
  }

  /** Records until `stop` is called; resolves with the clip (null if empty). */
  function record(s: MediaStream): { done: Promise<Blob | null>; stop: () => void } {
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(s, { mimeType: format!.mime });
    recorder.current = rec;
    const done = new Promise<Blob | null>((resolve) => {
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: format!.mime }) : null);
      rec.onerror = () => resolve(null);
    });
    rec.start();
    return { done, stop: () => rec.state === "recording" && rec.stop() };
  }

  function play(r: QuickResult): Promise<void> {
    if (!r.audio || !speakRef.current) return Promise.resolve();
    player.current?.pause();
    const el = new Audio(`data:${r.audio_mime ?? "audio/wav"};base64,${r.audio}`);
    player.current = el;
    return new Promise((resolve) => {
      el.onended = () => resolve();
      el.onerror = () => resolve();
      el.play().catch(() => resolve());
    });
  }

  /** Fetches and plays the voice for a result whose text is already on screen. */
  async function replay(r: QuickResult) {
    try {
      const v = await quickApi.speak({ text: r.translation, language: r.target_language });
      await play({ ...r, ...v });
    } catch {
      /* voice is optional: the text stays on screen */
    }
  }

  /** Sends one clip. `side` = who spoke (hold mode); undefined = detect from the language (hands-free). */
  async function translate(blob: Blob, side?: Side): Promise<boolean> {
    setBusy(true);
    try {
      const l = langRef.current;
      const r = await quickApi.speech(blob, `speech.${format!.ext}`, side
        ? { source_language: l[side], target_language: l[other(side)], speak: false }
        : { source_language: "auto", target_language: l.b, speak: false, pair: `${l.a},${l.b}` });
      const speaker: Side = side ?? (r.source_language === l.a ? "a" : "b");
      setLast({ speaker, result: r });
      setError("");
      if (speakRef.current && r.translation) {
        // Text is already on screen; fetch the (slower) voice now.
        const v = await quickApi.speak({ text: r.translation, language: r.target_language });
        await play({ ...r, ...v });
      }
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Translation failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---------- hold to talk ----------

  async function holdStart(side: Side) {
    if (recording || busy || !format) return;
    setError("");
    player.current?.pause();
    const s = await openMic();
    if (!s) return;
    const started = Date.now();
    const clip = record(s);
    setRecording(side);
    const finish = async () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
      clip.stop();
      const blob = await clip.done;
      setRecording(null);
      releaseMic();
      if (Date.now() - started < 400 || !blob) return setError("Tap the mic, speak, then tap again.");
      await translate(blob, side);
    };
    holdStop.current = finish;
    holdTimer.current = setTimeout(() => void finish(), MAX_HOLD_MS);
  }
  function toggleMic(side: Side) {
    if (recording === side) holdEnd();
    else void holdStart(side);
  }
  function holdEnd() {
    const f = holdStop.current;
    holdStop.current = null;
    if (f) void f();
  }

  // ---------- hands-free ----------

  async function startListening() {
    if (!format) return;
    setError("");
    const s = await openMic();
    if (!s) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(s).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const detector = createTurnDetector();
    let clip = record(s); // runs from the start so the first syllable is not cut off
    let paused = false;
    let restartAt = Date.now() + 20000;

    const tick = async () => {
      if (paused) return;
      analyser.getFloatTimeDomainData(buf);
      const db = levelDb(buf);
      setLevel(db);
      const event = detector.push(db, Date.now());
      if (event === "start") setRecording("auto");
      if (event === "end" || event === "discard") {
        paused = true; // don't listen to our own translated voice
        clip.stop();
        const blob = await clip.done;
        setRecording(null);
        if (event === "end" && blob) await translate(blob);
        detector.reset();
        if (!loop.current) return;
        clip = record(s);
        restartAt = Date.now() + 20000;
        paused = false;
      } else if (!detector.speaking && Date.now() > restartAt) {
        // Long silence: start a fresh clip so it does not grow forever.
        clip.stop();
        await clip.done;
        clip = record(s);
        restartAt = Date.now() + 20000;
      }
    };
    const id = setInterval(() => void tick(), 50);
    loop.current = {
      stop: () => {
        clearInterval(id);
        clip.stop();
        void ctx.close();
      },
    };
    setListening(true);
  }

  function stopListening() {
    releaseMic();
    setListening(false);
    setRecording(null);
    setLevel(-100);
  }

  function changeMode(m: Mode) {
    if (listening) stopListening();
    setMode(m);
  }

  const half = (side: Side) => {
    const mine = last?.speaker === side;
    const text = last ? (mine ? last.result.original : last.result.translation) : "";
    const active = recording === side;
    const lname = LANGS.find((l) => l.code === lang[side]);
    const name = lname?.name ?? "";
    const accent = side === "a" ? "text-brand" : "text-accent";
    const bar = side === "a" ? "bg-brand" : "bg-accent";
    const ring = side === "a" ? "border-brand" : "border-accent";
    const hint = active ? "Listening… tap to send" : busy ? "Translating…" : mode === "auto" ? "Just speak, then pause" : "Tap on the mic to speak";
    return (
      <section
        className={`card glow-border flex min-h-[340px] flex-1 flex-col overflow-hidden ${table && side === "a" ? "rotate-180" : ""}`}
        aria-label={`${name} speaker`}
      >
        <div className={`h-1 ${bar}`} />
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Language">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  role="radio"
                  aria-checked={lang[side] === l.code}
                  disabled={Boolean(recording) || busy || listening || l.code === lang[other(side)]}
                  onClick={() => setLang({ ...lang, [side]: l.code })}
                  className={`rounded-full border px-3.5 py-1 text-sm font-semibold transition disabled:opacity-35 ${
                    lang[side] === l.code ? `${ring} bg-subtle ${accent}` : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {l.native}
                </button>
              ))}
            </div>
            {last && !mine && (
              <button className="btn-ghost h-10 w-10 shrink-0 rounded-full p-0" aria-label="Play translation again" title="Play again" onClick={() => void replay(last.result)}>
                <SpeakerIcon width={22} height={22} />
              </button>
            )}
          </div>
          <div className="flex flex-1 items-center">
            {text ? (
              <p className={`text-3xl leading-snug font-semibold sm:text-4xl ${mine ? accent : "text-ink"}`} aria-live="polite">
                {text}
              </p>
            ) : (
              <p className="text-lg text-muted">{mode === "auto" ? `Speak ${name} — the translation is spoken automatically.` : `Tap the mic and speak ${name}.`}</p>
            )}
          </div>
          <div className="flex flex-col items-center gap-3">
            {mode === "tap" && (
              <div className="relative grid h-24 w-24 place-items-center">
                {active && <span className="absolute inset-0 animate-ping rounded-full border-2 border-danger" />}
                <button
                  onClick={() => toggleMic(side)}
                  disabled={Boolean(recording && !active) || busy || !format}
                  aria-label={active ? "Stop and translate" : `Tap to speak ${name}`}
                  className={`relative grid h-20 w-20 select-none place-items-center rounded-full border-[3px] transition disabled:opacity-45 ${
                    active ? "border-danger bg-danger text-white" : `${ring} bg-canvas ${accent} hover:shadow-(--shadow-glow)`
                  }`}
                >
                  <MicIcon width={32} height={32} />
                </button>
              </div>
            )}
            <p className="rounded-full border border-line bg-subtle px-4 py-1.5 text-sm text-muted">{hint}</p>
          </div>
        </div>
      </section>
    );
  };

  return (
    <Layout wide>
      <PageHeader
        eyebrow="Tools"
        title="Face to face"
        description="One device between two people. Each speaks their own language and hears the other in theirs."
        actions={
          <div className="flex rounded-full border border-line p-1 text-sm" role="radiogroup" aria-label="Mode">
            {(["tap", "auto"] as Mode[]).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => changeMode(m)}
                className={`rounded-full px-4 py-1.5 font-semibold transition ${mode === m ? "bg-gradient-to-br from-brand to-neon text-[#050816]" : "text-muted hover:text-ink"}`}
              >
                {m === "tap" ? "Tap to talk" : "Hands-free"}
              </button>
            ))}
          </div>
        }
      />
      {!format && <ErrorBanner message="This browser cannot record audio. Try Chrome, Edge or Safari." />}
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className={`mt-4 flex flex-col gap-4 ${table ? "" : "md:flex-row"}`}>
        {half("a")}
        <div className="flex items-center justify-center">
          <button
            className="btn-ghost h-10 w-10 rounded-full p-0"
            title="Swap languages"
            disabled={Boolean(recording) || busy || listening}
            onClick={() => setLang({ a: lang.b, b: lang.a })}
          >
            <SwapIcon width={18} height={18} />
          </button>
        </div>
        {half("b")}
      </div>

      {mode === "auto" && (
        <div className="card mt-4 flex flex-wrap items-center gap-4 p-4">
          <button className={listening ? "btn-danger" : "btn-primary"} onClick={() => (listening ? stopListening() : void startListening())} disabled={!format}>
            <MicIcon width={18} height={18} /> {listening ? "Stop listening" : "Start listening"}
          </button>
          <div className="min-w-[160px] flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <div className={`h-full transition-[width] ${recording ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.max(0, Math.min(100, (level + 70) * 1.6))}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted" aria-live="polite">
              {!listening ? "Off" : busy ? "Translating…" : recording ? "Hearing someone speak…" : "Listening — speak one at a time and pause when you finish"}
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Speak translations aloud
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={table} onChange={(e) => setTable(e.target.checked)} /> Device lies flat between us (turn the top side around)
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">Hands-free works best in a quiet place with one person speaking at a time. Nothing you say is stored.</p>
    </Layout>
  );
}
