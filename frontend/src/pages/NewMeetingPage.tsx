import { useEffect, useState } from "react";

import { meetingsApi } from "../api";
import { ErrorBanner, Layout } from "../components/Layout";
import { AudioUploader } from "../components/meetings/AudioUploader";
import { LiveTranslator } from "../components/meetings/LiveTranslator";
import { MeetingRecorder } from "../components/meetings/MeetingRecorder";
import type { MeetingConfig } from "../types";

const TABS = [
  { key: "live", title: "Live translate", hint: "Live transcript + translation while you talk (LiveKit). Audio is recorded too." },
  { key: "record", title: "Record", hint: "Record this device’s microphone, then transcribe." },
  { key: "upload", title: "Upload file", hint: "WAV, MP3, M4A, WebM, OGG, FLAC or AAC from a recorder or phone." },
] as const;

export function NewMeetingPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("live");
  const [config, setConfig] = useState<MeetingConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    meetingsApi.config().then(setConfig).catch(() => setError("Could not load meeting settings from the server."));
  }, []);

  const active = TABS.find((t) => t.key === tab)!;
  return (
    <Layout>
      <h1 className="text-2xl font-semibold tracking-tight">New meeting</h1>
      <div className="mt-6 grid grid-cols-3 rounded-xl bg-subtle p-1 text-sm font-medium" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded-lg py-2 ${tab === t.key ? "bg-surface shadow-sm" : "text-muted"}`}>
            {t.title}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">{active.hint}</p>
      <div className="card mt-4 p-6">
        {error && <ErrorBanner message={error} />}
        {!config && !error && <p className="text-sm text-muted">Loading…</p>}
        {config && tab === "live" && <LiveTranslator config={config} />}
        {config && tab === "record" && <MeetingRecorder config={config} />}
        {config && tab === "upload" && <AudioUploader config={config} />}
      </div>
      <p className="mt-4 text-xs text-muted">
        Audio sources: this device’s microphone (Record, Live), files you upload, and translated calls in this app (enable “Save
        transcript” during a call). Computer system audio and ordinary mobile phone calls cannot be captured by a web app.
      </p>
    </Layout>
  );
}
