import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, api, directApi, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { CameraIcon, PhoneIcon } from "../components/Icons";
import { LanguagePicker } from "../components/LanguagePicker";
import { ErrorBanner, Layout, PageHeader } from "../components/Layout";
import type { DirectCall } from "../types";

const STATUS: Record<DirectCall["status"], string> = {
  ringing: "Ringing",
  answered: "Answered",
  declined: "Declined",
  missed: "Missed",
  cancelled: "Cancelled",
  ended: "Ended",
};

/** App-to-app dialer: call another user of this app by username or mobile number (free). */
export function DialPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefs = user?.preferences;
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs?.spoken_language ?? "ta-IN",
    listen_language: prefs?.listen_language ?? "ta-IN",
    voice: prefs?.voice ?? "",
  });
  const [history, setHistory] = useState<DirectCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    directApi.list().then(setHistory).catch(() => undefined);
  }, []);

  async function call(video: boolean, target = to) {
    if (!target.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await directApi.call({ to: target.trim(), ...sel, video });
      void api.savePreferences({ spoken_language: sel.spoken_language, listen_language: sel.listen_language });
      navigate(`/call/${res.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the call");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void call(false);
  }

  return (
    <Layout>
      <PageHeader
        eyebrow="Calls"
        title="Dial"
        description="Call anyone who uses this app by their username or mobile number. Both of you hear each other translated. Free — no phone line needed."
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <form onSubmit={submit} className="card mt-4 space-y-5 p-6">
        <div>
          <label className="label" htmlFor="to">
            Username or mobile number
          </label>
          <input
            id="to"
            className="field text-lg"
            placeholder="ravi or 98765 43210"
            autoComplete="off"
            maxLength={40}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted">A mobile number works only if that person signed in with it (or an admin added it).</p>
        </div>
        <LanguagePicker value={sel} onChange={setSel} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary flex-1" disabled={busy || !to.trim()}>
            <PhoneIcon width={18} height={18} /> {busy ? "Calling…" : "Voice call"}
          </button>
          <button type="button" className="btn-secondary flex-1" disabled={busy || !to.trim()} onClick={() => void call(true)}>
            <CameraIcon width={18} height={18} /> Video call
          </button>
        </div>
      </form>

      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent</h2>
          <ul className="card mt-3 divide-y divide-line">
            {history.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                <div className="min-w-0">
                  <div className={`font-medium ${c.status === "missed" && c.direction === "incoming" ? "text-danger" : ""}`}>
                    {c.direction === "incoming" ? "↙" : "↗"} {c.other_name} <span className="text-muted">@{c.other_username}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(c.created_at).toLocaleString()} · {STATUS[c.status]}
                    {c.video ? " · video" : ""}
                  </div>
                </div>
                <button className="btn-ghost text-brand" disabled={busy} onClick={() => void call(c.video, c.other_username)}>
                  Call back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Layout>
  );
}
