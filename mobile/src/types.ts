export interface Preferences {
  display_name: string;
  spoken_language: string;
  listen_language: string;
  voice: string;
  show_subtitles: boolean;
  original_voice_volume: number;
}

export interface User {
  id: number;
  username: string;
  phone_number: string | null;
  preferences: Preferences;
}

export interface CallParticipant {
  identity: string;
  display_name: string;
  role: "host" | "guest";
  spoken_language: string;
  listen_language: string;
  voice: string;
  is_you: boolean;
  left_at: string | null;
}

export interface LatencyStat {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface CallUsage {
  stt_seconds: number;
  translate_chars: number;
  tts_chars: number;
  provider_requests: number;
  provider_errors: number;
  utterances: number;
  dropped_utterances: number;
  reconnects: number;
  latency: Record<string, LatencyStat>;
  finalized: boolean;
  updated_at: string;
}

export interface Room {
  code: string;
  status: "waiting" | "active" | "ended";
  translation_enabled: boolean;
  video_enabled: boolean;
  max_duration_seconds: number;
  invite_expires_at: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  end_reason: string;
  duration_seconds: number;
  participants: CallParticipant[];
  usage: CallUsage | null;
  /** Set when the room bridges a normal phone call. */
  phone: RoomPhone | null;
}

export interface RoomPhone {
  id: string;
  direction: "inbound" | "outbound";
  status: PhoneCall["status"];
  remote_number: string;
  sip_identity: string;
}

export interface RoomPreview {
  code: string;
  status: Room["status"];
  translation_enabled: boolean;
  video_enabled: boolean;
  host_name: string | null;
  participant_count: number;
  invite_expires_at: string;
}

export interface TokenResponse {
  token: string;
  url: string;
  identity: string;
  expires_in: number;
  room: Room;
}

export interface UsageTotals {
  call_seconds: number;
  stt_seconds: number;
  tts_chars: number;
  translate_chars: number;
}

export interface UsageSummary {
  today: UsageTotals;
  daily_limits: UsageTotals;
  per_call_limits: Omit<UsageTotals, "call_seconds">;
  max_call_duration_seconds: number;
  translation_enabled: boolean;
  mine: UsageTotals & { calls: number };
}

// ---------- Meetings ----------

export type MeetingLang = "ta" | "en" | "hi";
export type MeetingStatus = "draft" | "live" | "queued" | "transcribing" | "translating" | "summarizing" | "completed" | "failed";

export interface MeetingListItem {
  id: string;
  title: string;
  source: "upload" | "recording" | "live" | "call";
  status: MeetingStatus;
  progress: number;
  spoken_language: MeetingLang | "auto";
  translation_language: MeetingLang | "";
  recorded_at: string;
  duration_seconds: number;
  has_audio: boolean;
  has_summary: boolean;
  segment_count: number;
  created_at: string;
}

export interface TranscriptSegment {
  index: number;
  start_ms: number;
  end_ms: number;
  speaker: string;
  language: string;
  original_text: string;
  translated_text: string;
  translation_language: string;
  origin: "asr" | "live";
  edited_at: string | null;
}

export interface NotePoint {
  text: string;
  segments: number[];
}

export interface MeetingActionItem {
  id: number;
  order: number;
  text: string;
  owner_name: string;
  deadline: string;
  segment_indexes: number[];
  done: boolean;
}

export interface MeetingDetail extends MeetingListItem {
  error_message: string;
  transcription_engine: string;
  stt_seconds: number;
  translate_chars: number;
  audio_original_name: string;
  audio_size: number;
  summary: { summary: string; key_points: NotePoint[]; decisions: NotePoint[]; open_questions: NotePoint[] } | null;
  summary_language: MeetingLang;
  summary_model: string;
  summary_generated_at: string | null;
  summary_error: string;
  live_started_at: string | null;
  room_code: string | null;
  segments: TranscriptSegment[];
  action_items: MeetingActionItem[];
}

export interface MeetingConfig {
  languages: { code: MeetingLang; name: string }[];
  engines: Record<string, boolean>;
  default_engine: string;
  summaries_enabled: boolean;
  summary_model: string | null;
  max_upload_mb: number;
  max_duration_seconds: number;
  allowed_extensions: string[];
  translation_enabled: boolean;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ---------- Instant / face-to-face translation ----------

export interface QuickResult {
  original: string;
  source_language: string;
  translation: string;
  target_language: string;
  /** Base64 WAV of the spoken translation, when requested. */
  audio: string | null;
  audio_mime: string | null;
}

// ---------- AI assistant ----------

export interface AssistantConfig {
  enabled: boolean;
  max_image_mb: number;
  daily_requests_per_user: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PhotoTranslation {
  detected_language: string;
  summary: string;
  lines: { original: string; translation: string }[];
  language: string;
}

// ---------- Phone calls (LiveKit SIP) ----------

export interface PhoneConfig {
  enabled: boolean;
  dial_enabled: boolean;
  my_lines: string[];
  forwarding_number: string | null;
  allowed_prefixes: string[];
  ring_seconds: number;
}

export interface PhoneCall {
  id: string;
  room_code: string;
  direction: "inbound" | "outbound";
  status: "ringing" | "answered" | "missed" | "declined" | "failed" | "ended";
  remote_number: string;
  line_number: string;
  caller_language: string;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

// ---------- Plans ----------

export interface Plan {
  code: string;
  name: string;
  description: string;
  price_inr_month: number;
  daily_call_minutes: number;
  daily_assistant_requests: number;
  monthly_meeting_minutes: number;
  video_calls: boolean;
  phone_calls: boolean;
  daily_phone_calls: number;
}

export interface MyPlan {
  plan: Plan | null;
  usage: { call_minutes_today: number; assistant_requests_today: number; meeting_minutes_this_month: number; phone_calls_today: number };
  unlimited: boolean;
  plans: Plan[];
  payments: boolean;
}
