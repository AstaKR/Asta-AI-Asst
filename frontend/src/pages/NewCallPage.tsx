import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, api, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { Switch } from "../components/call/Switch";
import { TableArt } from "../components/call/TableArt";
import { CameraIcon } from "../components/Icons";
import { LanguagePicker } from "../components/LanguagePicker";
import { ErrorBanner, Layout } from "../components/Layout";

export function NewCallPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefs = user?.preferences;
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs?.spoken_language ?? "ta-IN",
    listen_language: prefs?.listen_language ?? "ta-IN",
    voice: prefs?.voice ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState(false);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const room = await api.createRoom(sel, video);
      void api.savePreferences({ spoken_language: sel.spoken_language, listen_language: sel.listen_language, voice: sel.voice ?? "" });
      navigate(`/call/${room.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the call");
      setBusy(false);
    }
  }

  const me = prefs?.display_name || user?.username || "You";
  return (
    <Layout>
      <p className="eyebrow">Step 1 of 2 · New call</p>
      <h1 className="page-title mt-1 text-[clamp(2.2rem,6vw,3.4rem)]">Set the table</h1>
      <p className="mt-2 max-w-lg text-muted">Pick the language you will speak. Next you get an invite code to share with the other person.</p>
      <div className="card mt-8 space-y-7 p-5 sm:p-7">
        <TableArt left={{ name: me, lang: sel.spoken_language }} />
        {error && <ErrorBanner message={error} />}
        <LanguagePicker value={sel} onChange={setSel} />
        <Switch checked={video} onChange={setVideo} title="Video call" icon={<CameraIcon width={20} height={20} />}>
          Camera on for both people. Translation works the same.
        </Switch>
        <ConsentNote />
        <button className="btn-primary w-full !min-h-12 !text-base sm:w-auto" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create call and get invite code"}
        </button>
      </div>
    </Layout>
  );
}

export function ConsentNote() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-edge/60 px-4 py-3 text-[0.82rem] leading-relaxed text-muted">
      <strong className="font-bold text-ink">AI translation notice.</strong> During the call your voice is streamed to an
      external AI service (Sarvam AI, India) for speech recognition, translation and speech synthesis. The call is not
      recorded, and audio and transcripts are not stored unless both people choose “Save transcript”. Translations can be wrong — confirm important details.
    </div>
  );
}
