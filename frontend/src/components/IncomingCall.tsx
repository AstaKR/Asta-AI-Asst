import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, directApi } from "../api";
import { useAuth } from "../auth";
import { NATIVE_NAMES } from "../lib/languages";
import type { DirectCall } from "../types";
import { PhoneIcon, PhoneOffIcon } from "./Icons";

const POLL_MS = 3000;

/** Short two-tone ring while a call is waiting (only after the page was interacted with; browsers block it before). */
function useRing(active: boolean) {
  useEffect(() => {
    if (!active || typeof AudioContext === "undefined") return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const ring = () => {
      if (!ctx || ctx.state !== "running") return;
      [0, 0.4].forEach((delay) => {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.frequency.value = 440 + delay * 100;
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx!.destination);
        osc.start(ctx!.currentTime + delay);
        osc.stop(ctx!.currentTime + delay + 0.3);
      });
    };
    ring();
    const id = setInterval(ring, 2500);
    return () => {
      clearInterval(id);
      void ctx?.close();
    };
  }, [active]);
}

/** App-to-app calls ringing for me. Shown on every signed-in page while the site is open. */
export function IncomingCall() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ringing, setRinging] = useState<DirectCall[]>([]);
  const [error, setError] = useState("");
  const title = useRef(document.title);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = () =>
      directApi
        .incoming()
        .then((r) => alive && setRinging(r))
        .catch(() => undefined);
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user]);

  const call = ringing[0];
  useRing(Boolean(call));
  useEffect(() => {
    const original = title.current;
    if (call) document.title = `📞 ${call.other_name} is calling`;
    return () => {
      document.title = original;
    };
  }, [call]);

  if (!call) return null;

  async function answer() {
    setError("");
    try {
      await directApi.answer(call.id, {
        spoken_language: user?.preferences.spoken_language,
        listen_language: user?.preferences.listen_language,
      });
      setRinging([]);
      navigate(`/call/${call.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not answer");
    }
  }

  async function decline() {
    setRinging((r) => r.filter((c) => c.id !== call.id));
    await directApi.decline(call.id).catch(() => undefined);
  }

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4" role="alertdialog" aria-label="Incoming call">
      <div className="card w-full max-w-sm p-5 shadow-xl">
        <p className="eyebrow text-accent">Incoming {call.video ? "video" : "voice"} call</p>
        <p className="mt-1 text-xl font-semibold text-ink">{call.other_name}</p>
        <p className="text-sm text-muted">
          @{call.other_username}
          {call.other_language ? ` · speaks ${NATIVE_NAMES[call.other_language] ?? call.other_language}` : ""} · translated by AI
        </p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button className="btn-danger flex-1" onClick={() => void decline()}>
            <PhoneOffIcon width={18} height={18} /> Decline
          </button>
          <button className="btn-primary flex-1" onClick={() => void answer()}>
            <PhoneIcon width={18} height={18} /> Answer
          </button>
        </div>
      </div>
    </div>
  );
}
