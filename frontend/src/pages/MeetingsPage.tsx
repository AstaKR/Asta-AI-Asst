import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, meetingsApi, type MeetingFilters } from "../api";
import { ErrorBanner, Layout } from "../components/Layout";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <Link to="/meetings/new" className="btn-primary">
          New meeting
        </Link>
      </div>
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
      <ul className="card mt-4 divide-y divide-line">
        {data && data.results.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted">No meetings found.</li>}
        {data?.results.map((m) => (
          <li key={m.id}>
            <Link to={`/meetings/${m.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-subtle">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.title}</div>
                <div className="text-xs text-muted">
                  {new Date(m.recorded_at).toLocaleString()} · {formatClock(m.duration_seconds * 1000)} · {SOURCE_LABEL[m.source]} ·{" "}
                  {meetingLanguageName(m.spoken_language)}
                  {m.translation_language && ` → ${meetingLanguageName(m.translation_language)}`}
                </div>
              </div>
              {m.has_summary && <span className="chip bg-brand-soft text-brand">Notes</span>}
              <span
                className={`chip ${m.status === "failed" ? "bg-danger-soft text-danger" : isProcessing(m.status) || m.status === "live" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"}`}
              >
                {STATUS_LABEL[m.status]}
                {isProcessing(m.status) && m.progress > 0 && ` ${m.progress}%`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {data && data.count > 20 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary py-1.5" disabled={!data.previous} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
            Previous
          </button>
          <span>
            Page {filters.page} of {pages}
          </span>
          <button className="btn-secondary py-1.5" disabled={!data.next} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
            Next
          </button>
        </div>
      )}
    </Layout>
  );
}
