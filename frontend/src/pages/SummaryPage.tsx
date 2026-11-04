import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError, api, isMemberView } from "../api";
import { ErrorBanner, Layout } from "../components/Layout";
import { languageName } from "../lib/languages";
import type { Room } from "../types";

const REASONS: Record<string, string> = {
  ended_by_participant: "Ended by a participant",
  max_call_duration: "Maximum call duration reached",
  declined: "Declined",
  not_answered: "Not answered",
  cancelled: "Cancelled before it was answered",
};

const METRIC_LABELS: Record<string, string> = {
  end_to_audio_ms: "Speech end → translated audio starts",
  first_transcript_ms: "Speech end → final transcript",
  translation_ms: "Translation request",
  tts_first_chunk_ms: "Speech synthesis → first audio",
  utterance_total_ms: "Speech end → translated audio fully queued",
};

export function SummaryPage() {
  const { code = "" } = useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let tries = 0;
    const load = () =>
      api
        .room(code)
        .then((r) => {
          if (!isMemberView(r)) throw new ApiError(403, "You were not part of this call.");
          setRoom(r);
          // The worker sends its final usage report a moment after the call ends.
          if (r.usage && !r.usage.finalized && tries++ < 3) setTimeout(load, 2000);
        })
        .catch((err) => setError(err.message ?? "Could not load the call"));
    load();
  }, [code]);

  const minutes = room ? Math.floor(room.duration_seconds / 60) : 0;
  const seconds = room ? room.duration_seconds % 60 : 0;
  const usage = room?.usage;

  return (
    <Layout>
      <h1 className="text-2xl font-semibold tracking-tight">Call summary</h1>
      {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      {room && (
        <div className="mt-6 space-y-4">
          <div className="card grid gap-4 p-6 sm:grid-cols-3">
            <Stat label="Duration" value={`${minutes}m ${String(seconds).padStart(2, "0")}s`} />
            <Stat label="Status" value={room.status === "ended" ? REASONS[room.end_reason] ?? "Ended" : "Still active"} />
            <Stat label="Languages" value={room.participants.map((p) => languageName(p.spoken_language)).join(" ↔ ")} />
          </div>
          <div className="card p-6">
            <h2 className="font-semibold">Participants</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {room.participants.map((p) => (
                <li key={p.identity}>
                  {p.display_name}
                  {p.is_you && " (you)"} — speaks {languageName(p.spoken_language)}, hears {languageName(p.listen_language)}
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-6">
            <h2 className="font-semibold">AI usage & measured latency</h2>
            {!room.translation_enabled && <p className="mt-2 text-sm text-muted">Translation was off for this call.</p>}
            {room.translation_enabled && !usage && <p className="mt-2 text-sm text-muted">No usage was reported for this call.</p>}
            {usage && (
              <>
                <div className="mt-4 grid gap-4 sm:grid-cols-4">
                  <Stat label="Speech recognised" value={`${usage.stt_seconds.toFixed(0)} s`} />
                  <Stat label="Translated" value={`${usage.translate_chars} chars`} />
                  <Stat label="Synthesised" value={`${usage.tts_chars} chars`} />
                  <Stat label="Sentences" value={`${usage.utterances}`} />
                </div>
                <p className="mt-3 text-xs text-muted">
                  Provider requests {usage.provider_requests} · errors {usage.provider_errors} · skipped sentences {usage.dropped_utterances} ·
                  reconnects {usage.reconnects}
                </p>
                {Object.keys(usage.latency).length > 0 && (
                  <table className="mt-4 w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-2 font-medium">Stage</th>
                        <th className="py-2 font-medium">Median</th>
                        <th className="py-2 font-medium">p95</th>
                        <th className="py-2 font-medium">Samples</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {Object.entries(usage.latency).map(([key, stat]) => (
                        <tr key={key}>
                          <td className="py-2">{METRIC_LABELS[key] ?? key}</td>
                          <td className="py-2 font-mono">{(stat.p50 / 1000).toFixed(2)} s</td>
                          <td className="py-2 font-mono">{(stat.p95 / 1000).toFixed(2)} s</td>
                          <td className="py-2">{stat.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
          <div className="flex gap-3">
            <Link to="/new" className="btn-primary">
              Start another call
            </Link>
            <Link to="/start" className="btn-secondary">
              Back to calls
            </Link>
          </div>
        </div>
      )}
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
