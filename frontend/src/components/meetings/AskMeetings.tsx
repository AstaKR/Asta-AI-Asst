import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, meetingsApi } from "../../api";
import { formatClock } from "../../lib/meetings";
import type { MeetingAnswer } from "../../types";

const EXAMPLES = ["What did we decide last time?", "Which action items are still open?", "Who promised what?"];

/** Recall: ask a question across all of your own meetings; the answer links to the meeting and moment. */
export function AskMeetings() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    try {
      setAnswer(await meetingsApi.ask(q.trim()));
    } catch (err) {
      setAnswer(null);
      setError(err instanceof ApiError ? err.message : "Could not get an answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card glow-border mt-6 p-5" aria-label="Ask your meetings">
      <p className="eyebrow">Recall</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          className="field flex-1"
          value={question}
          maxLength={500}
          placeholder="Ask your meetings anything…"
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Question"
        />
        <button className="btn-primary" disabled={busy || !question.trim()}>
          {busy ? "Searching…" : "Ask"}
        </button>
      </form>
      {!answer && !error && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              className="chip border border-line text-muted hover:text-ink"
              onClick={() => {
                setQuestion(e);
                void ask(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {answer && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className="text-[15px] leading-relaxed">{answer.answer}</p>
          {answer.sources.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-xs">
              {answer.sources.map((s, i) => (
                <li key={i}>
                  <Link
                    className="chip bg-subtle text-brand hover:underline"
                    to={`/meetings/${s.meeting_id}${s.start_ms != null ? `?t=${Math.floor(s.start_ms / 1000)}` : ""}`}
                  >
                    {s.title} · {new Date(s.recorded_at).toLocaleDateString()}
                    {s.start_ms != null ? ` · ${formatClock(s.start_ms)}` : ""}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
