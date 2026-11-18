import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { NativeModules } from "react-native";

const BACKEND_DEV_PORT = 8010;
const SERVER_KEY = "server_url";

/** In development the app is loaded from the PC's dev server; the backend runs on that same PC. */
function devHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "10.0.1.33:8081"
  if (hostUri) return hostUri.split(":")[0];
  const scriptURL: string | undefined = NativeModules.SourceCode?.scriptURL; // e.g. "http://10.0.1.33:8081/index.bundle?..."
  const match = scriptURL?.match(/^https?:\/\/([^:/]+)/);
  return match ? match[1] : null;
}

function builtInApiUrl(): string {
  if (__DEV__) {
    const host = devHost();
    // Follows the PC automatically when its Wi-Fi address changes.
    if (host && host !== "localhost") return `http://${host}:${BACKEND_DEV_PORT}`;
  }
  // Release builds: EXPO_PUBLIC_API_URL (e.g. https://call.example.com) in eas.json is the default server.
  return (process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:8000").replace(/\/$/, "");
}

/** The server the APK was built with. Users can point the app at another one on the Server screen. */
export const DEFAULT_API_URL = builtInApiUrl();

let apiUrl = DEFAULT_API_URL;
let customServer = false;

/** Current server, e.g. "https://app.example.com" (no trailing slash, no /api). */
export function getApiUrl(): string {
  return apiUrl;
}

export function isCustomServer(): boolean {
  return customServer;
}

/** Reads the saved server once at start-up, before any request is made. */
export async function loadServerUrl(): Promise<void> {
  const saved = await SecureStore.getItemAsync(SERVER_KEY).catch(() => null);
  if (saved) {
    apiUrl = saved;
    customServer = true;
  }
}

/** Saves a server address; null goes back to the built-in one. */
export async function saveServerUrl(url: string | null): Promise<void> {
  if (url && url !== DEFAULT_API_URL) {
    await SecureStore.setItemAsync(SERVER_KEY, url);
    apiUrl = url;
    customServer = true;
  } else {
    await SecureStore.deleteItemAsync(SERVER_KEY);
    apiUrl = DEFAULT_API_URL;
    customServer = false;
  }
}

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+$|.*\.local$)/i;

/**
 * Turns what the user typed into a server URL, or returns an error message.
 * "192.168.1.50:8000" → "http://192.168.1.50:8000"; "app.example.com" → "https://app.example.com".
 */
export function normalizeServerUrl(input: string): { url: string } | { error: string } {
  let text = input.trim().replace(/\s+/g, "");
  if (!text) return { error: "Enter the server address." };
  if (!/^https?:\/\//i.test(text)) {
    const host = text.split(/[/:]/)[0];
    // Office Wi-Fi servers usually have no certificate; internet servers should use HTTPS.
    text = `${LOCAL_HOST.test(host) ? "http" : "https"}://${text}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { error: "That doesn't look like a server address." };
  }
  if (!parsed.hostname || !/^[a-z0-9.\-\[\]:]+$/i.test(parsed.hostname)) return { error: "That doesn't look like a server address." };
  const path = parsed.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
  return { url: `${parsed.protocol}//${parsed.host}${path}` };
}

export interface ServerCheck {
  ok: boolean;
  message: string;
}

/** Calls GET /api/health/ on a server to confirm it is an ASTA server and reachable. */
export async function checkServer(url: string, timeoutMs = 8000): Promise<ServerCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/health/`, { headers: { Accept: "application/json" }, signal: controller.signal });
    const data = (await res.json().catch(() => null)) as { status?: string; translation_enabled?: boolean; livekit_configured?: boolean } | null;
    if (!data || typeof data.status !== "string") return { ok: false, message: `Something answered (HTTP ${res.status}), but it is not this app's server.` };
    if (data.status !== "ok") return { ok: false, message: "The server is running but its database is not ready." };
    const extras = [data.livekit_configured ? null : "calls not set up", data.translation_enabled ? null : "translation off"].filter(Boolean);
    return { ok: true, message: extras.length ? `Connected (${extras.join(", ")}).` : "Connected." };
  } catch {
    return {
      ok: false,
      message: controller.signal.aborted
        ? "No answer within 8 seconds. Check the address, and that the phone and server are on the same network or the server is online."
        : "Cannot reach the server. Check the address, the port and the phone's internet/Wi-Fi.",
    };
  } finally {
    clearTimeout(timer);
  }
}
