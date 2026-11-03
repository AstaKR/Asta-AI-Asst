import { AudioTrack, LiveKitRoom, StartAudio, useConnectionState, useDataChannel, useLocalParticipant, useRemoteParticipants, useRoomContext, useTracks } from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, api, meetingsApi } from "../../api";
import { isMyTranslationTrack } from "../../lib/audioPolicy";
import { formatClock, pickRecorderFormat } from "../../lib/meetings";
import { initialTranslatorState, parseTranslatorMessage, translatorReducer } from "../../lib/translatorEvents";
import type { MeetingConfig, TokenResponse } from "../../types";
import { ErrorBanner } from "../Layout";
import { Subtitles } from "../Subtitles";
import { CONSENT_TEXT, MeetingSetupFields, defaultSetup, type MeetingSetup } from "./MeetingSetupFields";

interface Session {
  meetingId: string;
  code: string;
  token: TokenResponse;
}

/**
 * Live meeting: speech is transcribed (and translated) in real time by the LiveKit translation
 * worker, while the browser records the same microphone so the saved meeting has audio.
 */
export function LiveTranslator({ config }: { config: MeetingConfig }) {
  const [setup, setSetup] = useState<MeetingSetup>(defaultSetup());
  const [voice, setVoice] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await meetingsApi.startLive({ ...setup, voice_playback: voice });
      const token = await api.token(res.room_code);
      setSession({ meetingId: res.meeting.id, code: res.room_code, token });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the live session");
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <LiveKitRoom
        serverUrl={session.token.url}
        token={session.token.token}
        connect
        video={false}
        audio={{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }}
        options={{ adaptiveStream: false, dynacast: false }}
        onError={(err) => !/client initiated/i.test(err.message) && setError(err.message)}
      >
        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        <LiveSession session={session} maxSeconds={config.max_duration_seconds} voice={voice} />
      </LiveKitRoom>
    );
  }

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {!config.translation_enabled && (
        <ErrorBanner message="Live AI processing is turned off on this server. Use Record or Upload instead." />
      )}
      <MeetingSetupFields value={setup} onChange={setSetup} allowAuto={false} consentText={CONSENT_TEXT} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={voice} disabled={!setup.translation_language} onChange={(e) => setVoice(e.target.checked)} />
        Speak the translation aloud (uses headphones best; costs extra AI voice usage)
      </label>
      <button className="btn-primary" disabled={busy || !setup.consent || !setup.title.trim() || !config.translation_enabled} onClick={() => void start()}>
        {busy ? "Starting…" : "Start live session"}
      </button>
    </div>
  );
}

function LiveSession({ session, maxSeconds, voice }: { session: Session; maxSeconds: number; voice: boolean }) {
  const navigate = useNavigate();
  const room = useRoomContext();
  const connection = useConnectionState();
  const remotes = useRemoteParticipants();
  const { localParticipant, microphoneTrack, isMicrophoneEnabled } = useLocalParticipant();
  const [state, dispatch] = useReducer(translatorReducer, initialTranslatorState);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<"live" | "saving" | "error">("live");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const format = useRef<{ mime: string; ext: string } | null>(null);
  const blob = useRef<Blob | null>(null);

  useDataChannel("translator", (msg) => {
    if (msg.from && !msg.from.isAgent) return;
    const parsed = parseTranslatorMessage(msg.payload);
    if (parsed) dispatch(parsed);
  });

  // Record the same microphone track that is sent to LiveKit. Muting (pause) records silence,
  // so the audio timeline stays aligned with the live transcript timestamps.
  const mst = microphoneTrack?.track?.mediaStreamTrack;
  useEffect(() => {
    if (!mst || recorder.current) return;
    format.current = pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m));
    if (!format.current) {
      setError("This browser cannot record audio; the live transcript is still saved.");
      return;
    }
    const rec = new MediaRecorder(new MediaStream([mst]), { mimeType: format.current.mime, audioBitsPerSecond: 64000 });
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.start(1000);
    recorder.current = rec;
    void meetingsApi.liveStarted(session.meetingId, Date.now()).catch(() => undefined);
  }, [mst, session.meetingId]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (elapsed >= maxSeconds - 2 && phase === "live") void finish();
  }, [elapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = recorder.current;
      if (!rec || rec.state === "inactive") return resolve(blob.current);
      rec.onstop = () => {
        blob.current = new Blob(chunks.current, { type: format.current!.mime });
        resolve(blob.current);
      };
      rec.stop();
    });
  }

  async function finish() {
    setPhase("saving");
    setError("");
    const audio = await stopRecorder();
    try {
      if (audio && audio.size > 0) {
        const form = new FormData();
        form.append("file", new File([audio], `live.${format.current?.ext ?? "webm"}`, { type: audio.type }));
        await meetingsApi.attachAudio(session.meetingId, form, setProgress);
      }
      await api.end(session.code).catch(() => undefined);
      await room.disconnect();
      navigate(`/meetings/${session.meetingId}`);
    } catch (err) {
      setPhase("error");
      setError(err instanceof ApiError ? `Saving the audio failed: ${err.message}` : "Saving the audio failed.");
    }
  }

  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  const translatorReady = remotes.some((p) => p.isAgent);

  return (
    <div className="space-y-4">
      {tracks
        .filter((t) => t.participant.isAgent && voice && isMyTranslationTrack(t.publication?.trackName, session.token.identity))
        .map((t) => (
          <AudioTrack key={t.publication?.trackSid} trackRef={t} volume={1} />
        ))}
      <StartAudio label="Tap to enable translated voice" className="btn-secondary" />
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip ${connection === ConnectionState.Connected ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"}`}>
          {connection === ConnectionState.Connected ? "Connected" : "Connecting…"}
        </span>
        <span className={`chip ${translatorReady ? "bg-brand-soft text-brand" : "bg-subtle text-muted"}`}>
          {state.availability === "disabled" ? "AI unavailable" : translatorReady ? "Live transcription on" : "Transcriber joining…"}
        </span>
        <span className={`chip ${recorder.current ? "bg-danger-soft text-danger" : "bg-subtle text-muted"}`}>
          <span className="h-2 w-2 rounded-full bg-current" /> {recorder.current ? (isMicrophoneEnabled ? "Recording" : "Paused (muted)") : "Not recording"}
        </span>
        <span className="chip bg-subtle font-mono text-ink">
          {formatClock(elapsed * 1000)} / {formatClock(maxSeconds * 1000)}
        </span>
      </div>
      {state.availability === "limit" && <ErrorBanner message="Live AI processing stopped: usage limit reached. Recording continues." />}
      <Subtitles state={state} myIdentity={session.token.identity} nameOf={() => "You"} partialEnabled />
      <div className="flex flex-wrap gap-3">
        <button className="btn-secondary" disabled={phase !== "live"} onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>
          {isMicrophoneEnabled ? "Pause (mute)" : "Resume"}
        </button>
        <button className="btn-danger" disabled={phase === "saving"} onClick={() => void finish()}>
          {phase === "saving" ? `Saving ${Math.round(progress * 100)}%…` : phase === "error" ? "Retry saving" : "Stop and save"}
        </button>
        {phase === "error" && blob.current && (
          <a className="btn-secondary" href={URL.createObjectURL(blob.current)} download={`live.${format.current?.ext}`}>
            Download recording
          </a>
        )}
      </div>
    </div>
  );
}
