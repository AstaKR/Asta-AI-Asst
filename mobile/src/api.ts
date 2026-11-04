import { API_URL } from "./config";
import type {
  MeetingActionItem,
  MeetingConfig,
  MeetingDetail,
  MeetingListItem,
  Paginated,
  AssistantConfig,
  ChatMessage,
  MyPlan,
  DirectCall,
  PhoneCall,
  PhoneConfig,
  PhotoTranslation,
  Preferences,
  QuickResult,
  Room,
  RoomPreview,
  TokenResponse,
  TranscriptSegment,
  UsageSummary,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Headers for requests made outside fetch (audio player, downloads). */
export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Token ${authToken}` } : {};
}

function messageFrom(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    for (const value of Object.values(d)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") return first;
    }
  }
  if (status === 429) return "Too many requests — please wait a moment.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Request failed (${status})`;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers.Authorization = `Token ${authToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your internet connection.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, messageFrom(data, res.status), (data as { code?: string }).code);
  return data as T;
}

export interface LanguageSelection {
  spoken_language: string;
  listen_language: string;
  voice?: string;
}

export interface AppConfig {
  languages: { code: string; name: string }[];
  voices: string[];
  translation_enabled: boolean;
  phone_forwarding_number: string | null;
}

export const api = {
  config: () => request<AppConfig>("/languages/"),
  requestOtp: (phone: string) => request<{ sent_to: string; expires_in: number; resend_in: number }>("/auth/otp/request/", "POST", { phone }),
  verifyOtp: (phone: string, code: string, display_name?: string) =>
    request<{ token: string; is_new: boolean; user: User }>("/auth/otp/verify/", "POST", { phone, code, display_name }),
  me: () => request<User>("/auth/me/"),
  logout: () => request<void>("/auth/logout/", "POST"),
  savePreferences: (prefs: Partial<Preferences>) => request<Preferences>("/preferences/", "PUT", prefs),
  rooms: () => request<Room[]>("/rooms/"),
  createRoom: (sel: LanguageSelection, video = false) => request<Room>("/rooms/", "POST", { ...sel, video }),
  room: (code: string) => request<Room | RoomPreview>(`/rooms/${encodeURIComponent(code)}/`),
  joinRoom: (code: string, sel: LanguageSelection) => request<Room>(`/rooms/${encodeURIComponent(code)}/join/`, "POST", sel),
  token: (code: string) => request<TokenResponse>(`/rooms/${encodeURIComponent(code)}/token/`, "POST"),
  end: (code: string) => request<Room>(`/rooms/${encodeURIComponent(code)}/end/`, "POST"),
  usage: () => request<UsageSummary>("/usage/"),
};

// ---------- Meetings ----------

export interface MeetingFilters {
  q?: string;
  language?: string;
  status?: string;
  page?: number;
}

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

/** Multipart upload with progress (React Native XHR reports upload progress; fetch does not). */
function uploadWithProgress<T>(
  path: string,
  fields: Record<string, string>,
  file: UploadFile,
  onProgress?: (f: number) => void,
  fileField = "file",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    // React Native's FormData streams the file from its local URI.
    form.append(fileField, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api${path}`);
    xhr.setRequestHeader("Accept", "application/json");
    if (authToken) xhr.setRequestHeader("Authorization", `Token ${authToken}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "Upload failed. Check your internet connection."));
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON error */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, messageFrom(data, xhr.status), (data as { code?: string }).code));
    };
    xhr.send(form);
  });
}

export type ExportKind = "txt" | "docx" | "csv" | "json" | "srt" | "vtt";

export const meetingsApi = {
  config: () => request<MeetingConfig>("/meetings/config/"),
  list: (f: MeetingFilters) => {
    const params = Object.entries(f)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return request<Paginated<MeetingListItem>>(`/meetings/?${params}`);
  },
  get: (id: string) => request<MeetingDetail>(`/meetings/${id}/`),
  remove: (id: string) => request<void>(`/meetings/${id}/`, "DELETE"),
  upload: (fields: Record<string, string>, file: UploadFile, onProgress?: (f: number) => void) =>
    uploadWithProgress<MeetingDetail>("/meetings/", fields, file, onProgress),
  transcribe: (id: string) => request<MeetingDetail>(`/meetings/${id}/transcribe/`, "POST", {}),
  translate: (id: string, language: string) => request<MeetingDetail>(`/meetings/${id}/translate/`, "POST", { language }),
  summarize: (id: string, language?: string) => request<MeetingDetail>(`/meetings/${id}/summarize/`, "POST", language ? { language } : {}),
  updateSegment: (id: string, index: number, body: Partial<Pick<TranscriptSegment, "original_text" | "translated_text">>) =>
    request<TranscriptSegment>(`/meetings/${id}/segments/${index}/`, "PATCH", body),
  updateActionItem: (id: string, itemId: number, body: Partial<MeetingActionItem>) =>
    request<MeetingActionItem>(`/meetings/${id}/action-items/${itemId}/`, "PATCH", body),
  startLive: (body: { title: string; spoken_language: string; translation_language: string; voice_playback: boolean; consent: boolean }) =>
    request<{ meeting: MeetingDetail; room_code: string }>("/meetings/live/", "POST", body),
  liveStarted: (id: string, recording_started_at_ms: number) =>
    request<void>(`/meetings/${id}/live-started/`, "POST", { recording_started_at_ms }),
  audioUrl: (id: string) => `${API_URL}/api/meetings/${id}/audio/`,
  exportUrl: (id: string, kind: ExportKind) => `${API_URL}/api/meetings/${id}/export/?kind=${kind}`,
};

export function isMemberView(room: Room | RoomPreview): room is Room {
  return "participants" in room;
}

export const quickApi = {
  text: (body: { text: string; source_language: string; target_language: string; speak: boolean }) =>
    request<QuickResult>("/quick/text/", "POST", body),
  /** `pair` ("ta,hi"): hands-free conversation; the spoken language is detected and translated into the other. */
  speech: (fields: { source_language: string; target_language: string; speak: boolean; transcribe_only?: boolean; pair?: string }, file: UploadFile) =>
    uploadWithProgress<QuickResult>(
      "/quick/speech/",
      { ...fields, speak: String(fields.speak), transcribe_only: String(Boolean(fields.transcribe_only)), pair: fields.pair ?? "" },
      file,
    ),
};

export const assistantApi = {
  config: () => request<AssistantConfig>("/assistant/config/"),
  chat: (messages: ChatMessage[], language: string) => request<{ reply: string }>("/assistant/chat/", "POST", { messages, language }),
  image: (file: UploadFile, language: string, onProgress?: (f: number) => void) =>
    uploadWithProgress<PhotoTranslation>("/assistant/image/", { language }, file, onProgress, "image"),
};

export const phoneApi = {
  config: () => request<PhoneConfig>("/phone/config/"),
  dial: (body: { number: string; spoken_language: string; listen_language: string; caller_language: string }) =>
    request<PhoneCall>("/phone/dial/", "POST", body),
  calls: () => request<PhoneCall[]>("/phone/calls/"),
  incoming: () => request<PhoneCall[]>("/phone/incoming/"),
  answer: (id: string) => request<PhoneCall>(`/phone/calls/${id}/answer/`, "POST"),
  decline: (id: string) => request<PhoneCall>(`/phone/calls/${id}/decline/`, "POST"),
  connected: (id: string) => request<PhoneCall>(`/phone/calls/${id}/connected/`, "POST"),
};

export const planApi = {
  mine: () => request<MyPlan>("/me/plan/"),
};

/** App-to-app dialer: call another user of this app by username or mobile number (free). */
export const directApi = {
  call: (body: { to: string; spoken_language: string; listen_language: string; video: boolean; voice?: string }) =>
    request<DirectCall>("/direct/calls/", "POST", body),
  list: () => request<DirectCall[]>("/direct/calls/"),
  incoming: () => request<DirectCall[]>("/direct/incoming/"),
  answer: (id: string, body: { spoken_language?: string; listen_language?: string } = {}) =>
    request<DirectCall>(`/direct/calls/${id}/answer/`, "POST", body),
  /** Callee: decline. Caller: cancel while it rings. */
  decline: (id: string) => request<DirectCall>(`/direct/calls/${id}/decline/`, "POST"),
};

/** Call recording (voices + transcript): saved only when every participant agrees. */
export const recordingApi = {
  consent: (code: string, save: boolean) =>
    request<{ save_transcript: boolean; my_consent: boolean; waiting_for: string[]; records_audio: boolean }>(
      `/rooms/${encodeURIComponent(code)}/transcript/`,
      "POST",
      { save },
    ),
};
