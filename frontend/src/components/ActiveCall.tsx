import {
  AudioTrack,
  StartAudio,
  useConnectionState,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useMediaDeviceSelect,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { ConnectionState, ParticipantKind, RoomEvent, Track, type Participant } from "livekit-client";
import { useCallback, useEffect, useReducer, useState } from "react";

import { ApiError, api, isMemberView, meetingsApi, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { effectiveLanguage, isMyTranslationTrack, micAllowedIdentities, needsTranslation, originalVolume } from "../lib/audioPolicy";
import { languageName, NATIVE_NAMES } from "../lib/languages";
import { initialTranslatorState, parseTranslatorMessage, translatorReducer } from "../lib/translatorEvents";
import type { Room, TokenResponse } from "../types";
import { CameraIcon, CameraOffIcon, CopyIcon, MicIcon, MicOffIcon, PhoneOffIcon, SettingsIcon } from "./Icons";
import { LanguagePicker } from "./LanguagePicker";
import { Brand, ErrorBanner } from "./Layout";
import { Subtitles } from "./Subtitles";

const supportsOutputSelection = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

function useAttributesRerender() {
  const room = useRoomContext();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    room.on(RoomEvent.ParticipantAttributesChanged, bump);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, bump);
    };
  }, [room]);
}

/** Recording state pushed by the server in the room metadata (who agreed, whether it is on). */
function useRecordingState() {
  const room = useRoomContext();
  const read = useCallback(() => {
    try {
      const m = JSON.parse(room.metadata || "{}") as { save_transcript?: boolean; record_consent?: string[]; record_audio?: boolean };
      return { saving: Boolean(m.save_transcript), consented: m.record_consent ?? [], audio: Boolean(m.record_audio) };
    } catch {
      return { saving: false, consented: [] as string[], audio: false };
    }
  }, [room]);
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    update();
    room.on(RoomEvent.RoomMetadataChanged, update);
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, update);
    };
  }, [room, read]);
  return state;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  code: string;
  session: TokenResponse;
  mediaError: string;
  onClearError: () => void;
}

export function ActiveCall({ code, session, mediaError, onClearError }: Props) {
  const room = useRoomContext();
  const { user } = useAuth();
  const connection = useConnectionState();
  const remotes = useRemoteParticipants();
  useAttributesRerender();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [info, setInfo] = useState<Room>(session.room);
  const [state, dispatch] = useReducer(translatorReducer, initialTranslatorState);
  const [origVolume, setOrigVolume] = useState(user?.preferences.original_voice_volume ?? 15);
  const [showSubtitles, setShowSubtitles] = useState(user?.preferences.show_subtitles ?? true);
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(false);
  const [translatorLate, setTranslatorLate] = useState(false);
  // Recording (voices + transcript): only after EVERY participant agrees (server enforces it too).
  // The room metadata tells everyone who has agreed, so the others see the request at once.
  const recording = useRecordingState();
  const [declinedAsk, setDeclinedAsk] = useState("");
  async function toggleTranscript(save = !recording.consented.includes(session.identity)) {
    try {
      await meetingsApi.callTranscriptConsent(code, save);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change call recording");
    }
  }
  const now = useNow();

  useDataChannel("translator", (msg) => {
    // Only the translation agent may drive the subtitle/status UI.
    if (msg.from && !msg.from.isAgent) return;
    const parsed = parseTranslatorMessage(msg.payload);
    if (parsed) dispatch(parsed);
  });

  const me = info.participants.find((p) => p.is_you);
  const myIdentity = session.identity;
  const mySpoken = localParticipant.attributes.spoken_language || me?.spoken_language;
  const myListen = localParticipant.attributes.listen_language || me?.listen_language;
  const other = remotes.find((p) => !p.isAgent);
  const agent = remotes.find((p) => p.isAgent);
  const otherInfo = info.participants.find((p) => !p.is_you);
  const otherName = other?.name || otherInfo?.display_name || "Other participant";
  const otherSpoken = effectiveLanguage(
    other?.attributes.spoken_language || otherInfo?.spoken_language,
    other ? state.languageBySpeaker[other.identity] : undefined,
  );
  const otherIsPhone = other?.kind === ParticipantKind.SIP;
  const otherListen = other?.attributes.listen_language || otherInfo?.listen_language;
  const iNeedTranslation = needsTranslation(otherSpoken, myListen);
  const theyNeedTranslation = needsTranslation(mySpoken, otherListen);
  const anyTranslation = iNeedTranslation || theyNeedTranslation;
  const iConsented = recording.consented.includes(myIdentity);
  const othersAsked = recording.consented.some((id) => id !== myIdentity);
  const recordWhat = recording.audio ? "Voices and transcript" : "Transcript";
  const translatorAvailable =
    info.translation_enabled && Boolean(agent) && !["disabled", "limit", "error"].includes(state.availability);

  // Phone callers can't duck my original voice: while translation for them works, only the agent gets my mic.
  const agentIds = remotes.filter((p) => p.isAgent).map((p) => p.identity).join(",");
  useEffect(() => {
    const allowed = micAllowedIdentities({
      otherIsPhone,
      translationForOtherActive: theyNeedTranslation && translatorAvailable,
      agentIdentities: agentIds ? agentIds.split(",") : [],
    });
    localParticipant.setTrackSubscriptionPermissions(
      allowed === null,
      allowed?.map((participantIdentity) => ({ participantIdentity, allowAll: true })) ?? [],
    );
  }, [localParticipant, otherIsPhone, theyNeedTranslation, translatorAvailable, agentIds]);

  // Refresh server-side room info while waiting for the other person (to show their name/languages).
  const isDirect = Boolean(info.direct);
  useEffect(() => {
    if (other && otherInfo) return;
    const id = setInterval(() => {
      api.room(code).then((r) => isMemberView(r) && setInfo(r)).catch(() => undefined);
    }, isDirect ? 2000 : 5000);
    return () => clearInterval(id);
  }, [code, other, otherInfo, isDirect]);

  useEffect(() => {
    setTranslatorLate(false);
    if (!info.translation_enabled || agent || !other || !anyTranslation) return;
    const id = setTimeout(() => setTranslatorLate(true), 10000);
    return () => clearTimeout(id);
  }, [info.translation_enabled, agent, other, anyTranslation]);

  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });
  const audioElements = tracks
    .filter((t) => !t.participant.isLocal)
    .map((t) => {
      if (t.participant.isAgent) {
        if (!isMyTranslationTrack(t.publication?.trackName, myIdentity)) return null;
        return <AudioTrack key={t.publication?.trackSid} trackRef={t} volume={1} />;
      }
      const volume = originalVolume({
        otherSpokenLanguage: effectiveLanguage(t.participant.attributes.spoken_language, state.languageBySpeaker[t.participant.identity]),
        myListenLanguage: myListen,
        translatorAvailable,
        originalVoiceVolume: origVolume,
      });
      return <AudioTrack key={t.publication?.trackSid} trackRef={t} volume={volume} />;
    });

  const startedAt = info.started_at ? new Date(info.started_at).getTime() : now;
  const elapsed = (now - startedAt) / 1000;
  const remaining = info.max_duration_seconds - elapsed;

  const endCall = useCallback(async () => {
    setEnding(true);
    try {
      await api.end(code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not end the call on the server");
    }
    await room.disconnect();
  }, [code, room]);

  const toggleMic = () => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => setError("Could not access the microphone."));

  const toggleCamera = () =>
    void localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => setError("Could not access the camera. Allow it in your browser settings."));
  const cameras = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteCam = cameras.find((t) => !t.participant.isLocal && !t.participant.isAgent && t.publication?.track && !t.publication.isMuted);
  const localCam = cameras.find((t) => t.participant.isLocal && t.publication?.track && !t.publication.isMuted);
  const lastLine = state.lines[state.lines.length - 1];

  const nameOf = (identity: string) => (identity === myIdentity ? "You" : identity === other?.identity ? otherName : identity);

  return (
    <div className="flex h-full min-h-screen flex-col bg-canvas">
      {audioElements}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Brand />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ConnectionChip state={connection} />
            <TranslatorChip enabled={info.translation_enabled} agentPresent={Boolean(agent)} availability={state.availability} needed={anyTranslation} />
            {recording.saving && (
              <span className="chip bg-danger-soft font-semibold text-danger" title={`${recordWhat} — everyone agreed`}>
                ● REC
              </span>
            )}
            <span className="chip bg-subtle font-mono text-ink" title="Call time / limit">
              {formatClock(elapsed)} / {formatClock(info.max_duration_seconds)}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-5 sm:px-6">
        <StartAudio label="Tap to enable call audio" className="btn-primary w-full" />
        {othersAsked && !iConsented && declinedAsk !== recording.consented.join() && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
            <span>
              <strong>{otherName}</strong> wants to record this call ({recordWhat.toLowerCase()}). It is saved only if you agree too.
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary h-9" onClick={() => setDeclinedAsk(recording.consented.join())}>
                No
              </button>
              <button className="btn-primary h-9" onClick={() => void toggleTranscript(true)}>
                Agree
              </button>
            </span>
          </div>
        )}
        {(mediaError || error) && (
          <ErrorBanner
            message={mediaError || error}
            onDismiss={() => {
              setError("");
              onClearError();
            }}
          />
        )}
        {connection === ConnectionState.Reconnecting && (
          <Banner tone="warn">Connection unstable — reconnecting… Audio will resume automatically.</Banner>
        )}
        {translatorLate && (
          <Banner tone="warn">The AI translator has not joined yet. You can hear the original voice; translation starts when it connects.</Banner>
        )}
        {state.availability === "disabled" && (
          <Banner tone="warn">AI translation is unavailable on the server ({state.availabilityMessage || "disabled"}). You hear the original voice.</Banner>
        )}
        {state.availability === "limit" && (
          <Banner tone="warn">Translation stopped: {limitMessage(state.availabilityMessage)} You now hear the original voice.</Banner>
        )}
        {state.availability === "error" && <Banner tone="danger">Translation stopped: {state.availabilityMessage}</Banner>}
        {state.notice && state.availability === "ready" && <Banner tone="info">{state.notice}</Banner>}
        {remaining < 60 && remaining > 0 && <Banner tone="warn">The call ends in {Math.ceil(remaining)} s (duration limit).</Banner>}

        {info.video_enabled && (
          <div className="relative aspect-video max-h-[60vh] w-full overflow-hidden rounded-2xl bg-slate-900">
            {remoteCam ? (
              <VideoTrack trackRef={remoteCam} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-300">
                {other ? `${otherName}'s camera is off` : "Waiting for the other person…"}
              </div>
            )}
            {localCam && (
              <VideoTrack trackRef={localCam} className="absolute bottom-3 right-3 w-28 rounded-xl border-2 border-white object-cover sm:w-44 [transform:scaleX(-1)]" />
            )}
            {showSubtitles && lastLine && lastLine.speaker !== myIdentity && (
              <p className="absolute bottom-3 left-3 right-36 rounded-lg bg-slate-900/75 px-3 py-2 text-base text-white sm:right-52">
                {lastLine.translation ?? lastLine.original}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <PersonCard
              participant={localParticipant}
              title="You"
              initial={(me?.display_name || "Y").slice(0, 1)}
              spoken={mySpoken}
              listen={myListen}
              activity={state.activity[myIdentity]}
              muted={!isMicrophoneEnabled}
            />
            {other ? (
              <PersonCard
                participant={other}
                title={otherName}
                spoken={otherSpoken}
                listen={otherListen}
                activity={state.activity[other.identity]}
              />
            ) : info.direct ? (
              <RingingCard name={info.direct.callee_name} status={info.direct.status} onCancel={() => void endCall()} />
            ) : (
              <InviteCard code={code} hasJoinedBefore={Boolean(otherInfo)} name={otherInfo?.display_name} />
            )}
            {other && (
              <div className="card space-y-1.5 p-4 text-sm">
                <Direction from={mySpoken} to={otherListen} label={`You → ${otherName}`} />
                <Direction from={otherSpoken} to={myListen} label={`${otherName} → You`} />
                {state.lastMetrics?.end_to_audio_ms !== undefined && (
                  <p className="pt-1 text-xs text-muted">
                    Last translation delay: {(state.lastMetrics.end_to_audio_ms / 1000).toFixed(1)} s after the sentence ended
                  </p>
                )}
              </div>
            )}
          </div>
          {showSubtitles ? (
            <Subtitles state={state} myIdentity={myIdentity} nameOf={nameOf} partialEnabled />
          ) : (
            <div className="card grid min-h-[280px] place-items-center p-6 text-sm text-muted">Subtitles are hidden.</div>
          )}
        </div>

        {panel && (
          <SettingsPanel
            code={code}
            current={{ spoken_language: mySpoken ?? "ta-IN", listen_language: myListen ?? "ta-IN", voice: me?.voice }}
            origVolume={origVolume}
            setOrigVolume={setOrigVolume}
            showSubtitles={showSubtitles}
            setShowSubtitles={setShowSubtitles}
            onRoomUpdate={setInfo}
          />
        )}
      </div>

      <footer className="sticky bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-3">
          <button
            onClick={toggleMic}
            aria-pressed={!isMicrophoneEnabled}
            className={`btn h-12 w-12 rounded-full p-0 ${isMicrophoneEnabled ? "border border-line bg-surface text-ink hover:bg-subtle" : "bg-warn-soft text-warn"}`}
            title={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          >
            {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
            <span className="sr-only">{isMicrophoneEnabled ? "Mute" : "Unmute"}</span>
          </button>
          {info.video_enabled && (
            <button
              onClick={toggleCamera}
              aria-pressed={!isCameraEnabled}
              className={`btn h-12 w-12 rounded-full p-0 ${isCameraEnabled ? "border border-line bg-surface text-ink hover:bg-subtle" : "bg-warn-soft text-warn"}`}
              title={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
            >
              {isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
              <span className="sr-only">{isCameraEnabled ? "Camera off" : "Camera on"}</span>
            </button>
          )}
          <button
            onClick={() => setPanel(!panel)}
            aria-expanded={panel}
            className="btn h-12 w-12 rounded-full border border-line bg-surface p-0 text-ink hover:bg-subtle"
            title="Audio, language and subtitle settings"
          >
            <SettingsIcon />
            <span className="sr-only">Settings</span>
          </button>
          <button
            onClick={() => void toggleTranscript()}
            aria-pressed={iConsented}
            className={`btn h-12 rounded-full px-4 ${recording.saving ? "bg-danger-soft text-danger" : iConsented ? "bg-warn-soft text-warn" : "border border-line bg-surface text-ink hover:bg-subtle"}`}
            title={`${recordWhat} to Meetings. Everyone in the call must agree. Press again to stop.`}
          >
            {recording.saving ? "● Recording — stop" : iConsented ? `Waiting for ${otherName}` : othersAsked ? "Agree to record" : "Record call"}
          </button>
          <button onClick={() => void endCall()} disabled={ending} className="btn-danger h-12 rounded-full px-6">
            <PhoneOffIcon /> {ending ? "Ending…" : "End call"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function limitMessage(reason: string): string {
  if (reason.includes("credits")) return "the AI provider's credits are exhausted.";
  if (reason.startsWith("daily")) return "today's usage limit was reached.";
  if (reason.startsWith("per_call")) return "this call's usage limit was reached.";
  if (reason === "max_call_duration") return "the maximum call duration was reached.";
  return reason ? `${reason.replace(/_/g, " ")}.` : "a usage limit was reached.";
}

function Banner({ tone, children }: { tone: "warn" | "danger" | "info"; children: React.ReactNode }) {
  const styles = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    info: "border-brand/20 bg-brand-soft text-brand",
  }[tone];
  return (
    <div role="status" className={`rounded-xl border px-4 py-2.5 text-sm ${styles}`}>
      {children}
    </div>
  );
}

function ConnectionChip({ state }: { state: ConnectionState }) {
  const map: Record<string, [string, string]> = {
    [ConnectionState.Connected]: ["Connected", "bg-accent-soft text-accent"],
    [ConnectionState.Connecting]: ["Connecting…", "bg-subtle text-muted"],
    [ConnectionState.Reconnecting]: ["Reconnecting…", "bg-warn-soft text-warn"],
    [ConnectionState.SignalReconnecting]: ["Reconnecting…", "bg-warn-soft text-warn"],
    [ConnectionState.Disconnected]: ["Disconnected", "bg-danger-soft text-danger"],
  };
  const [label, cls] = map[state] ?? [state, "bg-subtle text-muted"];
  return (
    <span className={`chip ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
    </span>
  );
}

function TranslatorChip(props: { enabled: boolean; agentPresent: boolean; availability: string; needed: boolean }) {
  let label = "AI translation active";
  let cls = "bg-brand-soft text-brand";
  if (!props.enabled || props.availability === "disabled") [label, cls] = ["Translation off", "bg-subtle text-muted"];
  else if (!props.needed) [label, cls] = ["Same language — no translation", "bg-subtle text-muted"];
  else if (props.availability === "limit" || props.availability === "error") [label, cls] = ["Translation stopped", "bg-warn-soft text-warn"];
  else if (!props.agentPresent) [label, cls] = ["Translator connecting…", "bg-subtle text-muted"];
  return <span className={`chip ${cls}`}>{label}</span>;
}

const ACTIVITY_LABEL: Record<string, string> = {
  listening: "Speaking…",
  transcribing: "Recognising speech…",
  translating: "Translating…",
  speaking: "Playing translation…",
  reconnecting: "Recognition reconnecting…",
  interrupted: "Translation interrupted",
  error: "Last sentence failed",
  limit: "Translation stopped",
};

function PersonCard(props: {
  participant: Participant;
  title: string;
  spoken?: string;
  listen?: string;
  activity?: string;
  muted?: boolean;
  initial?: string;
}) {
  const speaking = useIsSpeaking(props.participant);
  return (
    <div className={`card p-4 transition-shadow ${speaking ? "ring-2 ring-accent/40" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft font-semibold text-brand">
            {(props.initial ?? props.title.slice(0, 1)).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold">{props.title}</div>
            <div className="text-xs text-muted">
              Speaks {languageName(props.spoken)}
              {props.listen && props.listen !== props.spoken ? ` · hears ${languageName(props.listen)}` : ""}
            </div>
          </div>
        </div>
        {props.muted && <span className="chip bg-warn-soft text-warn">Muted</span>}
      </div>
      <div className="mt-3 h-5 text-xs text-muted">
        {speaking ? <span className="text-accent">● Speaking</span> : props.activity && ACTIVITY_LABEL[props.activity]}
      </div>
    </div>
  );
}

function Direction({ from, to, label }: { from?: string; to?: string; label: string }) {
  const same = from === to;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="font-medium">
        {same ? `${languageName(from)} (no translation)` : `${NATIVE_NAMES[from ?? ""] ?? from} → ${NATIVE_NAMES[to ?? ""] ?? to}`}
      </span>
    </div>
  );
}

/** App-to-app call placed from the dialer: no invite code, the other person's app rings. */
function RingingCard({ name, status, onCancel }: { name: string; status: string; onCancel: () => void }) {
  const text: Record<string, string> = {
    ringing: "Ringing…",
    answered: "Answered — connecting…",
    declined: "Declined the call",
    missed: "Did not answer",
    cancelled: "Call cancelled",
    ended: "Call ended",
  };
  return (
    <div className="card p-4 text-center">
      <div className="text-lg font-semibold">{name}</div>
      <p className={`mt-1 text-sm ${status === "ringing" || status === "answered" ? "text-muted" : "text-danger"}`} aria-live="polite">
        {text[status] ?? status}
      </p>
      {status === "ringing" && (
        <button onClick={onCancel} className="btn-secondary mt-3 w-full">
          Cancel
        </button>
      )}
    </div>
  );
}

function InviteCard({ code, hasJoinedBefore, name }: { code: string; hasJoinedBefore: boolean; name?: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${code}`;
  const copy = () =>
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  return (
    <div className="card p-4">
      <div className="font-semibold">{hasJoinedBefore ? `Waiting for ${name ?? "the other person"} to connect…` : "Invite the other person"}</div>
      <p className="mt-1 text-xs text-muted">Share this code or link. They need an account to join.</p>
      <div className="mt-3 rounded-xl bg-subtle px-3 py-2 text-center font-mono text-xl tracking-[0.25em]">{code}</div>
      <button onClick={copy} className="btn-secondary mt-3 w-full">
        <CopyIcon width={16} height={16} /> {copied ? "Link copied" : "Copy invite link"}
      </button>
    </div>
  );
}

function SettingsPanel(props: {
  code: string;
  current: LanguageSelection;
  origVolume: number;
  setOrigVolume: (n: number) => void;
  showSubtitles: boolean;
  setShowSubtitles: (b: boolean) => void;
  onRoomUpdate: (r: Room) => void;
}) {
  const room = useRoomContext();
  const [sel, setSel] = useState<LanguageSelection>(props.current);
  const [msg, setMsg] = useState("");
  const outputs = useMediaDeviceSelect({ kind: "audiooutput", room, requestPermissions: false });
  const inputs = useMediaDeviceSelect({ kind: "audioinput", room, requestPermissions: false });

  async function applyLanguages() {
    setMsg("");
    try {
      const updated = await api.changeLanguages(props.code, sel);
      props.onRoomUpdate(updated);
      setMsg(updated.live_update_applied ? "Languages updated for this call." : "Saved; applies when you rejoin.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not update languages");
    }
  }

  return (
    <div className="card grid gap-6 p-5 md:grid-cols-2">
      <div className="space-y-4">
        <h2 className="font-semibold">Audio</h2>
        <label className="block">
          <span className="label">Microphone</span>
          <select className="field" value={inputs.activeDeviceId} onChange={(e) => void inputs.setActiveMediaDevice(e.target.value)}>
            {inputs.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
        {supportsOutputSelection && outputs.devices.length > 0 && (
          <label className="block">
            <span className="label">Speaker / headphones</span>
            <select className="field" value={outputs.activeDeviceId} onChange={(e) => void outputs.setActiveMediaDevice(e.target.value)}>
              {outputs.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Speaker"}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="label">Original voice under the translation: {props.origVolume}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={props.origVolume}
            onChange={(e) => props.setOrigVolume(Number(e.target.value))}
            className="w-full accent-[var(--color-brand)]"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={props.showSubtitles} onChange={(e) => props.setShowSubtitles(e.target.checked)} />
          Show live subtitles
        </label>
        <p className="text-xs text-muted">Tip: headphones give the best translation quality and prevent echo.</p>
      </div>
      <div className="space-y-4">
        <h2 className="font-semibold">Languages for this call</h2>
        <LanguagePicker value={sel} onChange={setSel} showVoice={false} />
        <button className="btn-secondary" onClick={() => void applyLanguages()}>
          Apply
        </button>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </div>
    </div>
  );
}
