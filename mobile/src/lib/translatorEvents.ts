// Shared with frontend/src/lib — keep both copies identical.
/** Messages published by the translation worker on data topic "translator". */

export type SubtitleStage = "partial" | "final" | "translation" | "skipped";

export interface SubtitleMessage {
  type: "subtitle";
  stage: SubtitleStage;
  utterance_id: string;
  speaker: string;
  listener: string;
  language: string;
  text: string;
  original?: string;
}

export interface StatusMessage {
  type: "status";
  state: string;
  speaker?: string;
  listener?: string;
  message?: string;
  provider?: string;
  partial_transcripts?: boolean;
}

export interface MetricsMessage {
  type: "metrics";
  utterance_id: string;
  speaker: string;
  end_to_audio_ms?: number;
  first_transcript_ms?: number;
  translation_ms?: number;
  tts_first_chunk_ms?: number;
  utterance_total_ms?: number;
}

export type TranslatorMessage = SubtitleMessage | StatusMessage | MetricsMessage;

export interface SubtitleLine {
  id: string;
  speaker: string;
  original: string;
  originalLanguage: string;
  translation?: string;
  translationLanguage?: string;
  pending: boolean; // still a partial transcript
  skipped: boolean;
}

export interface TranslatorState {
  /** "unknown" until the worker announces itself. */
  availability: "unknown" | "ready" | "disabled" | "limit" | "error";
  availabilityMessage: string;
  /** Per speaker identity: listening / transcribing / translating / speaking / idle / ... */
  activity: Record<string, string>;
  lines: SubtitleLine[];
  /** Partial-transcript line per speaker (one at a time). */
  partialBySpeaker: Record<string, string>;
  lastMetrics?: MetricsMessage;
  notice?: string;
  /** Language actually detected per speaker (phone callers have spoken_language "auto"). */
  languageBySpeaker: Record<string, string>;
}

export const initialTranslatorState: TranslatorState = {
  availability: "unknown",
  availabilityMessage: "",
  activity: {},
  lines: [],
  partialBySpeaker: {},
  languageBySpeaker: {},
};

const MAX_LINES = 40;

export function parseTranslatorMessage(payload: Uint8Array | string): TranslatorMessage | null {
  try {
    const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
    const msg = JSON.parse(text);
    if (msg && typeof msg === "object" && ["subtitle", "status", "metrics"].includes(msg.type)) return msg;
  } catch {
    /* ignore malformed packets */
  }
  return null;
}

function upsert(lines: SubtitleLine[], id: string, patch: (line: SubtitleLine | undefined) => SubtitleLine): SubtitleLine[] {
  const idx = lines.findIndex((l) => l.id === id);
  if (idx === -1) return [...lines, patch(undefined)].slice(-MAX_LINES);
  const next = lines.slice();
  next[idx] = patch(lines[idx]);
  return next;
}

export function translatorReducer(state: TranslatorState, msg: TranslatorMessage): TranslatorState {
  switch (msg.type) {
    case "status": {
      if (msg.state === "ready" || msg.state === "disabled") {
        return { ...state, availability: msg.state, availabilityMessage: msg.message ?? "" };
      }
      if (msg.state === "warning") return { ...state, notice: msg.message };
      const activity = msg.speaker ? { ...state.activity, [msg.speaker]: msg.state } : state.activity;
      if (msg.state === "limit") {
        return { ...state, activity, availability: "limit", availabilityMessage: msg.message ?? "", notice: msg.message };
      }
      if (msg.state === "error") {
        // A speaker-scoped error may be transient ("one sentence failed"); a call-wide one is not.
        return msg.speaker
          ? { ...state, activity, notice: msg.message }
          : { ...state, activity, availability: "error", availabilityMessage: msg.message ?? "" };
      }
      return { ...state, activity, availability: state.availability === "unknown" ? "ready" : state.availability };
    }
    case "metrics":
      return { ...state, lastMetrics: msg };
    case "subtitle": {
      const { speaker, stage } = msg;
      if (stage === "partial") {
        return { ...state, partialBySpeaker: { ...state.partialBySpeaker, [speaker]: msg.text } };
      }
      const partialBySpeaker = { ...state.partialBySpeaker };
      if (stage === "final") delete partialBySpeaker[speaker];
      const lines = upsert(state.lines, msg.utterance_id, (line) => {
        const base: SubtitleLine = line ?? {
          id: msg.utterance_id,
          speaker,
          original: "",
          originalLanguage: msg.language,
          pending: false,
          skipped: false,
        };
        if (stage === "final") return { ...base, original: msg.text, originalLanguage: msg.language };
        if (stage === "translation")
          return {
            ...base,
            original: base.original || msg.original || "",
            translation: msg.text,
            translationLanguage: msg.language,
          };
        return { ...base, original: base.original || msg.text, skipped: true };
      });
      const languageBySpeaker =
        stage === "final" && msg.language && msg.language !== "auto"
          ? { ...state.languageBySpeaker, [speaker]: msg.language }
          : state.languageBySpeaker;
      return { ...state, lines, partialBySpeaker, languageBySpeaker };
    }
  }
}
