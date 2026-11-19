import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, api, isMemberView, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { TableArt } from "../components/call/TableArt";
import { LanguagePicker } from "../components/LanguagePicker";
import { ErrorBanner, Layout } from "../components/Layout";
import type { RoomPreview } from "../types";
import { ConsentNote } from "./NewCallPage";

export function JoinPage() {
  const { code = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefs = user?.preferences;
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs?.spoken_language ?? "hi-IN",
    listen_language: prefs?.listen_language ?? "hi-IN",
    voice: prefs?.voice ?? "",
  });

  useEffect(() => {
    api
      .room(code)
      .then((room) => {
        if (isMemberView(room)) {
          const me = room.participants.find((p) => p.is_you);
          if (room.status === "ended") navigate(`/call/${room.code}/summary`, { replace: true });
          else if (me) setSel({ spoken_language: me.spoken_language, listen_language: me.listen_language, voice: me.voice });
          setPreview({
            code: room.code,
            status: room.status,
            translation_enabled: room.translation_enabled,
            video_enabled: room.video_enabled,
            host_name: room.participants.find((p) => p.role === "host")?.display_name ?? null,
            participant_count: room.participants.length,
            invite_expires_at: room.invite_expires_at,
          });
        } else setPreview(room);
      })
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? "No call found with that code." : String(err.message ?? err)));
  }, [code, navigate]);

  async function join() {
    setBusy(true);
    setError("");
    try {
      await api.joinRoom(code, sel);
      navigate(`/call/${code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the call");
      setBusy(false);
    }
  }

  const me = prefs?.display_name || user?.username || "You";
  return (
    <Layout>
      <p className="eyebrow">You are invited</p>
      <h1 className="page-title mt-1 text-[clamp(2.1rem,5.6vw,3.2rem)]">{preview?.host_name ? `${preview.host_name} invited you to a call` : "Join a call"}</h1>
      <p className="mt-3 flex items-center gap-2 text-sm text-muted">
        Invite code <span className="sticker !text-sm font-mono tracking-[0.18em]">{code}</span>
      </p>
      <div className="card mt-7 space-y-7 p-5 sm:p-7">
        {error && <ErrorBanner message={error} />}
        {preview?.status === "ended" ? (
          <p className="text-sm text-muted">
            This call has ended.{" "}
            <Link to="/start" className="font-bold text-brand underline underline-offset-4">
              Start a new one
            </Link>
            .
          </p>
        ) : (
          <>
            <TableArt left={preview?.host_name ? { name: preview.host_name } : undefined} right={{ name: me, lang: sel.spoken_language }} />
            {preview && !preview.translation_enabled && (
              <div className="rounded-2xl border-2 border-warn bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">
                AI translation is turned off for this call (disabled or daily limit reached). You will hear the original voice only.
              </div>
            )}
            {preview?.video_enabled && (
              <div className="rounded-2xl border-2 border-brand bg-brand-soft px-4 py-3 text-sm font-semibold text-brand">This is a video call — your browser will ask for the camera.</div>
            )}
            <LanguagePicker value={sel} onChange={setSel} />
            <ConsentNote />
            <button className="btn-primary w-full !min-h-12 !text-base sm:w-auto" onClick={join} disabled={busy || !preview}>
              {busy ? "Joining…" : "Join call"}
            </button>
          </>
        )}
      </div>
    </Layout>
  );
}
