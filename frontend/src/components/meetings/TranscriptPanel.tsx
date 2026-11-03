import { useEffect, useRef, useState } from "react";

import { ApiError, meetingsApi } from "../../api";
import { formatClock, meetingLanguageName, searchSegments } from "../../lib/meetings";
import type { TranscriptSegment } from "../../types";

interface Props {
  meetingId: string;
  segments: TranscriptSegment[];
  translationLanguage: string;
  activeIndex: number | null;
  onSeek: (ms: number) => void;
  onSegmentSaved: (seg: TranscriptSegment) => void;
}

export function TranscriptPanel({ meetingId, segments, translationLanguage, activeIndex, onSeek, onSegmentSaved }: Props) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const activeRef = useRef<HTMLDivElement>(null);
  const shown = searchSegments(segments, query);
  const hasTranslation = segments.some((s) => s.translated_text);

  useEffect(() => {
    if (follow && !query) activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, follow, query]);

  return (
    <section className="card flex flex-col" aria-label="Transcript">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="font-semibold">Transcript</h2>
        <span className="text-xs text-muted">{segments.length} segments</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow audio
        </label>
        <input className="field w-56 py-1.5" placeholder="Search transcript…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transcript" />
      </div>
      {hasTranslation && (
        <div className="hidden grid-cols-[84px_1fr_1fr] gap-4 border-b border-line px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
          <span>Time</span>
          <span>Original</span>
          <span>Translation ({meetingLanguageName(translationLanguage)})</span>
        </div>
      )}
      <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
        {shown.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">{query ? "No matches." : "No transcript yet."}</p>}
        {shown.map((seg) => (
          <SegmentRow
            key={seg.index}
            ref={seg.index === activeIndex ? activeRef : undefined}
            meetingId={meetingId}
            seg={seg}
            active={seg.index === activeIndex}
            twoColumns={hasTranslation}
            onSeek={onSeek}
            onSaved={onSegmentSaved}
          />
        ))}
      </div>
    </section>
  );
}

function SegmentRow({
  meetingId,
  seg,
  active,
  twoColumns,
  onSeek,
  onSaved,
  ref,
}: {
  meetingId: string;
  seg: TranscriptSegment;
  active: boolean;
  twoColumns: boolean;
  onSeek: (ms: number) => void;
  onSaved: (seg: TranscriptSegment) => void;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState(seg.original_text);
  const [translated, setTranslated] = useState(seg.translated_text);
  const [error, setError] = useState("");

  async function save() {
    try {
      onSaved(await meetingsApi.updateSegment(meetingId, seg.index, { original_text: original, translated_text: translated }));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    }
  }

  return (
    <div ref={ref} className={`grid gap-2 px-5 py-3 text-sm md:gap-4 ${twoColumns ? "md:grid-cols-[84px_1fr_1fr]" : "md:grid-cols-[84px_1fr]"} ${active ? "bg-brand-soft" : ""}`}>
      <button className="self-start text-left font-mono text-xs text-brand hover:underline" onClick={() => onSeek(seg.start_ms)} title="Play from here">
        {formatClock(seg.start_ms)}
        {seg.speaker && <span className="block font-sans text-muted">{seg.speaker}</span>}
      </button>
      {editing ? (
        <>
          <textarea className="field min-h-20" value={original} onChange={(e) => setOriginal(e.target.value)} aria-label="Original text" />
          {twoColumns && <textarea className="field min-h-20" value={translated} onChange={(e) => setTranslated(e.target.value)} aria-label="Translated text" />}
          <div className="flex gap-2 md:col-start-2">
            <button className="btn-primary py-1.5" onClick={() => void save()}>
              Save
            </button>
            <button className="btn-secondary py-1.5" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {error && <span className="text-xs text-danger">{error}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="group leading-relaxed" onDoubleClick={() => setEditing(true)}>
            {seg.original_text}
            <button className="ml-2 text-xs text-muted opacity-60 hover:text-brand hover:opacity-100" onClick={() => setEditing(true)} aria-label="Edit segment">
              Edit
            </button>
            {seg.edited_at && <span className="ml-2 text-[11px] text-muted">(edited)</span>}
          </p>
          {twoColumns && <p className="leading-relaxed text-muted">{seg.translated_text}</p>}
        </>
      )}
    </div>
  );
}
