import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, meetingsApi, type MeetingFilters } from "../api";
import { PlusIcon } from "../components/Icons";
import { ErrorBanner, Layout } from "../components/Layout";
import { AskMeetings } from "../components/meetings/AskMeetings";
import { Reveal } from "../components/warm/Reveal";
import { MEETING_LANGUAGES, formatClock, isProcessing, meetingLanguageName } from "../lib/meetings";
import type { MeetingListItem, Paginated } from "../types";

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  queued: "Queued",
  transcribing: "Transcribing",
  translating: "Translating",
  summarizing: "Summarizing",
  completed: "Ready",
  failed: "Failed",
  draft: "Draft",
};

const SOURCE_LABEL: Record<string, string> = { upload: "Upload", recording: "Recording", live: "Live", call: "Call" };
// Notebook cover colour by where the meeting came from.
const COVER: Record<string, string> = { live: "bg-saffron", recording: "bg-mist", upload: "bg-blush", call: "bg-butter" };
const TILT = [-0.7, 0.5, -0.3, 0.8, -0.5, 0.3];

export function MeetingsPage() {
  const [filters, setFilters] = useState<MeetingFilters>({ page: 1 });
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Paginated<MeetingListItem> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => ({ ...f, q: query, page: 1 })), 350);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    meetingsApi
      .list(filters)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load meetings"));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  // Refresh while something is still processing.
  useEffect(() => {
    if (!data?.results.some((m) => isProcessing(m.status))) return;
    const id = setInterval(() => meetingsApi.list(filters).then(setData).catch(() => undefined), 4000);
    return () => clearInterval(id);
  }, [data, filters]);

  const set = (patch: MeetingFilters) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.count / 20)) : 1;

  return (
    <Layout wide>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5">Your notebooks</p>
          <h1 className="page-title text-[clamp(2.2rem,5vw,3.2rem)]">Meetings</h1>
        </div>
        <Link to="/meetings/new" className="btn-primary !min-h-12">
          <PlusIcon width={18} height={18} /> New meeting
        </Link>
      </div>
      <AskMeetings />
      <div className="card mt-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input className="field lg:col-span-2" placeholder="Search titles, transcripts, translations, notes…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search meetings" />
        <select className="field" value={filters.language ?? ""} onChange={(e) => set({ language: e.target.value })} aria-label="Language">
          <option value="">All languages</option>
          {MEETING_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <select className="field" value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {["completed", "live", "queued", "transcribing", "failed"].map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          <input type="date" className="field" value={filters.date_from ?? ""} onChange={(e) => set({ date_from: e.target.value })} aria-label="From date" />
          <input type="date" className="field" value={filters.date_to ?? ""} onChange={(e) => set({ date_to: e.target.value })} aria-label="To date" />
        </div>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {data && data.results.length === 0 && (
        <div className="mt-10 text-center">
          <p className="page-title text-[1.8rem]">No notebooks on the shelf yet.</p>
          <p className="wm-hand mt-2 text-[1.2rem] text-muted">Start a meeting and its transcript and notes will land here.</p>
        </div>
      )}
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {data?.results.map((m, i) => {
          const busy = isProcessing(m.status) || m.status === "live";
          return (
            <li key={m.id}>
              <Reveal delay={(i % 3) * 70} tilt={TILT[i % TILT.length]}>
                <Link
                  to={`/meetings/${m.id}`}
                  className="card card-hover relative flex h-full overflow-hidden !rounded-2xl !p-0 hover:!rotate-0"
                  style={{ rotate: `${TILT[i % TILT.length]}deg` }}
                >
                  {/* the binding */}
                  <span className="flex w-8 shrink-0 flex-col items-center justify-evenly border-r-2 border-edge bg-subtle py-3" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((d) => (
                      <span key={d} className="h-3 w-3 rounded-full border-2 border-edge bg-canvas" />
                    ))}
                  </span>
                  <div className={`flex min-w-0 flex-1 flex-col gap-2 p-4 text-[#1c1712] ${COVER[m.source] ?? "bg-surface"}`}>
                    {m.has_summary && <span className="absolute -top-1 right-5 h-8 w-4 bg-chilli [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" title="Has notes" aria-label="Has notes" />}
                    <h2 className="page-title pr-6 text-[1.3rem] leading-tight">{m.title}</h2>
                    <p className="text-xs leading-snug opacity-80">
                      {new Date(m.recorded_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {formatClock(m.duration_seconds * 1000)} · {SOURCE_LABEL[m.source]}
                    </p>
                    <p className="text-xs font-semibold">
                      {meetingLanguageName(m.spoken_language)}
                      {m.translation_language && ` → ${meetingLanguageName(m.translation_language)}`}
                    </p>
                    <div className="mt-auto pt-2">
                      <span
                        className={`chip !bg-surface ${m.status === "failed" ? "!text-danger" : busy ? "!text-warn" : "!text-accent"}`}
                      >
                        {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                        {STATUS_LABEL[m.status]}
                        {isProcessing(m.status) && m.progress > 0 && ` ${m.progress}%`}
                      </span>
                    </div>
                  </div>
                </Link>
              </Reveal>
            </li>
          );
        })}
      </ul>
      {data && data.count > 20 && (
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary" disabled={!data.previous} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
            Previous
          </button>
          <span className="font-bold">
            Page {filters.page} of {pages}
          </span>
          <button className="btn-secondary" disabled={!data.next} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
            Next
          </button>
        </div>
      )}
    </Layout>
  );
}
