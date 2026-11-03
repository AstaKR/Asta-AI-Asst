import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, api, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
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

  return (
    <Layout>
      <p className="text-sm font-medium text-brand">New call · Step 1 of 2</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Choose your language</h1>
      <div className="card mt-6 space-y-6 p-6">
        {error && <ErrorBanner message={error} />}
        <LanguagePicker value={sel} onChange={setSel} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
          Video call (camera on for both people; translation works the same)
        </label>
        <ConsentNote />
        <button className="btn-primary w-full sm:w-auto" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create call and get invite code"}
        </button>
      </div>
    </Layout>
  );
}

export function ConsentNote() {
  return (
    <div className="rounded-xl bg-subtle px-4 py-3 text-xs leading-relaxed text-muted">
      <strong className="font-semibold text-ink">AI translation notice.</strong> During the call your voice is streamed to an
      external AI service (Sarvam AI, India) for speech recognition, translation and speech synthesis. The call is not
      recorded, and audio and transcripts are not stored unless both people choose “Save transcript”. Translations can be wrong — confirm important details.
    </div>
  );
}
