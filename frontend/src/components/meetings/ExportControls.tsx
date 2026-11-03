import { Link } from "react-router-dom";

import { type ExportKind, meetingsApi } from "../../api";

const FORMATS: { kind: ExportKind; label: string; timed?: boolean }[] = [
  { kind: "txt", label: "TXT" },
  { kind: "docx", label: "Word" },
  { kind: "csv", label: "CSV" },
  { kind: "json", label: "JSON" },
  { kind: "srt", label: "Subtitles (SRT)", timed: true },
  { kind: "vtt", label: "Subtitles (VTT)", timed: true },
];

export function ExportControls({ meetingId, disabled, timed = true }: { meetingId: string; disabled?: boolean; timed?: boolean }) {
  const cls = `btn-secondary py-1.5 ${disabled ? "pointer-events-none opacity-50" : ""}`;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Export">
      {FORMATS.filter((f) => timed || !f.timed).map((f) => (
        <a key={f.kind} className={cls} href={meetingsApi.exportUrl(meetingId, f.kind)} download>
          {f.label}
        </a>
      ))}
      <Link className={cls} to={`/meetings/${meetingId}/print`} target="_blank">
        Print / Save as PDF
      </Link>
    </div>
  );
}
