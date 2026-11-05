import type {
  AdminOverview,
  AdminUser,
  KeysPayload,
  MeetingActionItem,
  MeetingConfig,
  MeetingDetail,
  MeetingListItem,
  MyPlan,
  Paginated,
  Plan,
  Preferences,
  DirectCall,
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
    public data?: unknown,
  ) {
    super(message);
  }
}

function cookie(name: string): string {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : "";
}

let csrfReady: Promise<void> | null = null;
function ensureCsrf(): Promise<void> {
  if (cookie("csrftoken")) return Promise.resolve();
  csrfReady ??= fetch("/api/auth/csrf/", { credentials: "same-origin" }).then(() => undefined);
  return csrfReady;
}

function messageFrom(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    for (const [field, value] of Object.entries(d)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") return field === "non_field_errors" ? first : `${field.replace(/_/g, " ")}: ${first}`;
    }
  }
  if (status === 429) return "Too many requests — please wait a moment.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Request failed (${status})`;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    await ensureCsrf();
    headers["X-CSRFToken"] = cookie("csrftoken");
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data && typeof data === "object" ? (data as { code?: string }).code : undefined;
    throw new ApiError(res.status, messageFrom(data, res.status), code, data);
  }
  return data as T;
}

export interface LanguageSelection {
  spoken_language: string;
  listen_language: string;
  voice?: string;
}

export const api = {
  health: () => request<{ status: string; translation_enabled: boolean }>("/health/"),
  languages: () =>
    request<{ languages: { code: string; name: string }[]; voices: string[]; default_voice: string; translation_enabled: boolean }>(
      "/languages/",
    ),
  me: () => request<User>("/auth/me/"),
  login: (username: string, password: string) => request<User>("/auth/login/", "POST", { username, password }),
  register: (username: string, password: string, display_name: string) =>
    request<User>("/auth/register/", "POST", { username, password, display_name }),
  logout: () => request<void>("/auth/logout/", "POST"),
  requestPhoneCode: (phone: string) =>
    request<{ sent_to: string; expires_in: number; resend_in: number }>("/auth/phone/request/", "POST", { phone }),
  verifyPhone: (phone: string, code: string) => request<User>("/auth/phone/verify/", "POST", { phone, code }),
  removePhone: () => request<User>("/auth/phone/verify/", "DELETE"),
  savePreferences: (prefs: Partial<Preferences>) => request<Preferences>("/preferences/", "PUT", prefs),
  rooms: () => request<Room[]>("/rooms/"),
  createRoom: (sel: LanguageSelection, video = false) => request<Room>("/rooms/", "POST", { ...sel, video }),
  room: (code: string) => request<Room | RoomPreview>(`/rooms/${encodeURIComponent(code)}/`),
  joinRoom: (code: string, sel: LanguageSelection) => request<Room>(`/rooms/${encodeURIComponent(code)}/join/`, "POST", sel),
  token: (code: string) => request<TokenResponse>(`/rooms/${encodeURIComponent(code)}/token/`, "POST"),
  changeLanguages: (code: string, sel: LanguageSelection) =>
    request<Room & { live_update_applied: boolean }>(`/rooms/${encodeURIComponent(code)}/languages/`, "PATCH", sel),
  leave: (code: string) => request<void>(`/rooms/${encodeURIComponent(code)}/leave/`, "POST"),
  end: (code: string) => request<Room>(`/rooms/${encodeURIComponent(code)}/end/`, "POST"),
  usage: () => request<UsageSummary>("/usage/"),
};

// ---------- Meetings ----------

export interface MeetingFilters {
  q?: string;
  language?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}

/** Multipart upload with progress (fetch cannot report upload progress). */
export async function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  await ensureCsrf();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRFToken", cookie("csrftoken"));
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "Upload failed. Check your connection."));
    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, messageFrom(data, xhr.status), (data as { code?: string }).code, data));
    };
    xhr.send(form);
  });
}

// ---------- Instant translation (text / one utterance) ----------

export interface QuickResult {
  original: string;
  source_language: string;
  translation: string;
  target_language: string;
  audio: string | null; // base64 WAV
  audio_mime: string | null;
}

export interface EngineStatus {
  engine: "sarvam" | "local";
  ready: boolean;
  languages?: string[];
}

export interface AICapabilities {
  translate: EngineStatus;
  stt: EngineStatus;
  tts: EngineStatus;
  local_service: { configured: boolean; running: boolean; loaded: string[] };
}

export const quickApi = {
  text: (body: { text: string; source_language: string; target_language: string; speak: boolean }) =>
    request<QuickResult>("/quick/text/", "POST", body),
  /** `pair` ("ta,hi"): hands-free conversation; the spoken language is detected and translated into the other. */
  speech: (file: Blob, name: string, fields: { source_language: string; target_language: string; speak: boolean; pair?: string }) => {
    const form = new FormData();
    form.append("file", file, name);
    form.append("source_language", fields.source_language);
    form.append("target_language", fields.target_language);
    form.append("speak", String(fields.speak));
    if (fields.pair) form.append("pair", fields.pair);
    return uploadWithProgress<QuickResult>("/quick/speech/", form);
  },
  capabilities: () => request<AICapabilities>("/ai/capabilities/"),
};

export type ExportKind = "txt" | "docx" | "csv" | "json" | "srt" | "vtt";

export const meetingsApi = {
  config: () => request<MeetingConfig>("/meetings/config/"),
  list: (f: MeetingFilters) => {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    return request<Paginated<MeetingListItem>>(`/meetings/?${params}`);
  },
  get: (id: string) => request<MeetingDetail>(`/meetings/${id}/`),
  update: (id: string, body: Partial<Pick<MeetingDetail, "title" | "summary_language">>) =>
    request<MeetingDetail>(`/meetings/${id}/`, "PATCH", body),
  remove: (id: string) => request<void>(`/meetings/${id}/`, "DELETE"),
  upload: (form: FormData, onProgress?: (f: number) => void) => uploadWithProgress<MeetingDetail>("/meetings/", form, onProgress),
  attachAudio: (id: string, form: FormData, onProgress?: (f: number) => void) =>
    uploadWithProgress<MeetingDetail>(`/meetings/${id}/audio/`, form, onProgress),
  transcribe: (id: string, engine?: string) => request<MeetingDetail>(`/meetings/${id}/transcribe/`, "POST", engine ? { engine } : {}),
  translate: (id: string, language: string) => request<MeetingDetail>(`/meetings/${id}/translate/`, "POST", { language }),
  summarize: (id: string, language?: string) => request<MeetingDetail>(`/meetings/${id}/summarize/`, "POST", language ? { language } : {}),
  updateSegment: (id: string, index: number, body: Partial<Pick<TranscriptSegment, "original_text" | "translated_text" | "speaker">>) =>
    request<TranscriptSegment>(`/meetings/${id}/segments/${index}/`, "PATCH", body),
  updateActionItem: (id: string, itemId: number, body: Partial<MeetingActionItem>) =>
    request<MeetingActionItem>(`/meetings/${id}/action-items/${itemId}/`, "PATCH", body),
  startLive: (body: { title: string; spoken_language: string; translation_language: string; voice_playback: boolean; consent: boolean }) =>
    request<{ meeting: MeetingDetail; room_code: string }>("/meetings/live/", "POST", body),
  liveStarted: (id: string, recording_started_at_ms: number) =>
    request<void>(`/meetings/${id}/live-started/`, "POST", { recording_started_at_ms }),
  callTranscriptConsent: (code: string, save: boolean) =>
    request<{ save_transcript: boolean; my_consent: boolean; waiting_for: string[]; records_audio: boolean }>(
      `/rooms/${encodeURIComponent(code)}/transcript/`,
      "POST",
      { save },
    ),
  audioUrl: (id: string) => `/api/meetings/${id}/audio/`,
  exportUrl: (id: string, kind: ExportKind) => `/api/meetings/${id}/export/?kind=${kind}`,
};

export function isMemberView(room: Room | RoomPreview): room is Room {
  return "participants" in room;
}

export const planApi = {
  mine: () => request<MyPlan>("/me/plan/"),
};

export const adminApi = {
  overview: (days = 14) => request<AdminOverview>(`/admin/overview/?days=${days}`),
  users: (q = "", page = 1) => request<Paginated<AdminUser>>(`/admin/users/?${new URLSearchParams({ q, page: String(page) })}`),
  user: (id: number) => request<AdminUser>(`/admin/users/${id}/`),
  updateUser: (id: number, body: { is_active?: boolean; plan?: string; note?: string }) => request<AdminUser>(`/admin/users/${id}/`, "PATCH", body),
  plans: () => request<Plan[]>("/admin/plans/"),
  updatePlan: (code: string, body: Partial<Plan>) => request<Plan>(`/admin/plans/${code}/`, "PATCH", body),
  keys: () => request<KeysPayload>("/admin/keys/"),
  setKey: (name: string, value: string) => request<KeysPayload>(`/admin/keys/${name}/`, "PUT", { value }),
  clearKey: (name: string) => request<KeysPayload>(`/admin/keys/${name}/`, "DELETE"),
  testKey: (name: string) => request<{ ok: boolean; detail: string }>(`/admin/keys/${name}/test/`, "POST"),
};

// ---------- App-to-app dialer (call another user of this app; free) ----------

export const directApi = {
  call: (body: { to: string; spoken_language: string; listen_language: string; video: boolean; voice?: string }) =>
    request<DirectCall>("/direct/calls/", "POST", body),
  list: () => request<DirectCall[]>("/direct/calls/"),
  get: (id: string) => request<DirectCall>(`/direct/calls/${id}/`),
  incoming: () => request<DirectCall[]>("/direct/incoming/"),
  answer: (id: string, body: { spoken_language?: string; listen_language?: string } = {}) =>
    request<DirectCall>(`/direct/calls/${id}/answer/`, "POST", body),
  /** Callee: decline. Caller: cancel while it rings. */
  decline: (id: string) => request<DirectCall>(`/direct/calls/${id}/decline/`, "POST"),
};
