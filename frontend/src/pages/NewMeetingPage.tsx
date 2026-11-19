import { useEffect, useState } from "react";

import { meetingsApi } from "../api";
import { ArrowIcon, MeetingIcon, MicIcon } from "../components/Icons";
import { ErrorBanner, Layout } from "../components/Layout";
import { AudioUploader } from "../components/meetings/AudioUploader";
import { LiveMeeting } from "../components/meetings/LiveMeeting";
import { MeetingRecorder } from "../components/meetings/MeetingRecorder";
import type { MeetingConfig } from "../types";

const TABS = [
  { key: "live", title: "Live meeting", icon: MeetingIcon, hint: "Group meeting in the room: who said what, with live notes. Audio is recorded too." },
  { key: "record", title: "Record", icon: MicIcon, hint: "Record this device’s microphone, then transcribe." },
  { key: "upload", title: "Upload file", icon: ArrowIcon, hint: "WAV, MP3, M4A, WebM, OGG, FLAC or AAC from a recorder or phone." },
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
      <p className="eyebrow">New meeting</p>
      <h1 className="page-title mt-1 text-[clamp(2.2rem,5.5vw,3.2rem)]">How shall we capture it?</h1>
      <div className="mt-7 grid grid-cols-3 gap-2.5" role="tablist">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-2xl border-[2.5px] border-edge px-2 py-2 text-[0.85rem] font-bold transition duration-200 sm:flex-row sm:gap-2.5 sm:text-[0.95rem] ${
                on ? "-rotate-1 bg-saffron text-[#1c1712] shadow-[4px_4px_0_var(--color-shadow)]" : "bg-surface hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--color-shadow)]"
              }`}
            >
              <t.icon width={22} height={22} className={t.key === "upload" ? "-rotate-90" : ""} />
              {t.title}
            </button>
          );
        })}
      </div>
      <p className="wm-hand mt-4 text-[1.15rem] text-muted">{active.hint}</p>
      <div className="card mt-4 p-5 sm:p-6">
        {error && <ErrorBanner message={error} />}
        {!config && !error && <p className="text-sm text-muted">Loading…</p>}
        {config && tab === "live" && <LiveMeeting config={config} />}
        {config && tab === "record" && <MeetingRecorder config={config} />}
        {config && tab === "upload" && <AudioUploader config={config} />}
      </div>
      <p className="mt-4 text-xs text-muted">
        Audio sources: this device’s microphone (Live meeting, Record), files you upload, and translated calls in this app (enable “Save
        transcript” during a call). Computer system audio and ordinary mobile phone calls cannot be captured by a web app.
      </p>
    </Layout>
  );
}
