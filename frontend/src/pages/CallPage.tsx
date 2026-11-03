import { LiveKitRoom } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, api } from "../api";
import { ActiveCall } from "../components/ActiveCall";
import { Brand, ErrorBanner } from "../components/Layout";
import type { TokenResponse } from "../types";

type Phase = "loading" | "connected" | "disconnected" | "error";

export function CallPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<TokenResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");

  const inFlight = useRef<Promise<TokenResponse> | null>(null);

  const fetchToken = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      // De-duplicate concurrent requests (React StrictMode runs effects twice in development).
      inFlight.current ??= api.token(code).finally(() => {
        inFlight.current = null;
      });
      setSession(await inFlight.current);
      setPhase("connected");
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        navigate(`/call/${code}/summary`, { replace: true });
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        navigate(`/join/${code}`, { replace: true });
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not start the call");
      setPhase("error");
    }
  }, [code, navigate]);

  useEffect(() => {
    void fetchToken();
  }, [fetchToken]);

  const onDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.CLIENT_INITIATED) {
        navigate(`/call/${code}/summary`, { replace: true });
      } else {
        setPhase("disconnected");
      }
    },
    [code, navigate],
  );

  if (phase !== "connected" || !session) {
    return (
      <div className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface px-4 py-4 sm:px-6">
          <Brand />
        </header>
        <div className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
          {phase === "loading" && <p className="text-sm text-muted">Connecting to the call…</p>}
          {phase === "error" && (
            <div className="space-y-4">
              <ErrorBanner message={error} />
              <button className="btn-primary" onClick={() => void fetchToken()}>
                Try again
              </button>
            </div>
          )}
          {phase === "disconnected" && (
            <div className="card space-y-4 p-6">
              <h1 className="text-lg font-semibold">You were disconnected</h1>
              <p className="text-sm text-muted">The connection to the call was lost. The call may still be running.</p>
              <div className="flex justify-center gap-3">
                <button className="btn-primary" onClick={() => void fetchToken()}>
                  Rejoin
                </button>
                <Link to={`/call/${code}/summary`} className="btn-secondary">
                  Leave
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={session.url}
      token={session.token}
      connect
      video={session.room.video_enabled ? { resolution: { width: 640, height: 360, frameRate: 24 } } : false}
      audio={{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }}
      options={{ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true }}
      onDisconnected={onDisconnected}
      onError={(err) => {
        // Aborting a pending connection on unmount/reconnect is expected, not a user-facing error.
        if (/client initiated disconnect/i.test(err.message)) return;
        if (err.name === "NotAllowedError" || /permission denied/i.test(err.message)) {
          setError(
            session.room.video_enabled
              ? "Camera or microphone access was blocked. Allow them for this site in your browser settings, then rejoin."
              : "Microphone access was blocked. Allow the microphone for this site in your browser settings, then rejoin.",
          );
        } else setError(err.message);
      }}
      onMediaDeviceFailure={(_failure, kind) =>
        setError(
          kind === "videoinput"
            ? "Camera unavailable — the call continues with audio. Allow camera access in your browser to turn it on."
            : "Microphone unavailable. Allow microphone access in your browser and rejoin.",
        )
      }
      className="h-full"
    >
      <ActiveCall code={code} session={session} mediaError={error} onClearError={() => setError("")} />
    </LiveKitRoom>
  );
}
