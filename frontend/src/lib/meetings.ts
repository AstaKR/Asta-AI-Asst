import type { MeetingConfig, MeetingStatus, TranscriptSegment } from "../types";

export const MEETING_LANGUAGES = [
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
] as const;

export function meetingLanguageName(code: string | undefined): string {
  if (!code) return "—";
  if (code === "auto") return "Auto-detect";
  return MEETING_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const PROCESSING: MeetingStatus[] = ["queued", "transcribing", "translating", "summarizing"];

export function isProcessing(status: MeetingStatus): boolean {
  return PROCESSING.includes(status);
}

/** The segment being heard at `timeMs` (or the last one started before it). */
export function activeSegmentIndex(segments: TranscriptSegment[], timeMs: number): number | null {
  let found: number | null = null;
  for (const seg of segments) {
    if (seg.start_ms <= timeMs) found = seg.index;
    else break;
  }
  return found;
}

/** Case-insensitive search in original and translated text. */
export function searchSegments(segments: TranscriptSegment[], query: string): TranscriptSegment[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return segments;
  return segments.filter(
    (s) => s.original_text.toLocaleLowerCase().includes(q) || s.translated_text.toLocaleLowerCase().includes(q) || s.speaker.toLocaleLowerCase().includes(q),
  );
}

/** Browser recording format: WebM/Opus where supported (Chrome, Edge, Firefox), MP4/AAC on Safari. */
export function pickRecorderFormat(isTypeSupported: (mime: string) => boolean): { mime: string; ext: string } | null {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  return candidates.find((c) => isTypeSupported(c.mime)) ?? null;
}

/** Client-side pre-check (the server validates again by decoding the audio). */
export function checkUploadFile(file: { name: string; size: number }, config: Pick<MeetingConfig, "allowed_extensions" | "max_upload_mb">): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!config.allowed_extensions.includes(ext)) return `Unsupported file type ${ext || "(none)"}. Allowed: ${config.allowed_extensions.join(", ")}`;
  if (file.size === 0) return "The file is empty.";
  if (file.size > config.max_upload_mb * 1024 * 1024) return `The file is larger than ${config.max_upload_mb} MB.`;
  return null;
}
