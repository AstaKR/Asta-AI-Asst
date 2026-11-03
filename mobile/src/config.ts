import Constants from "expo-constants";
import { NativeModules } from "react-native";

const BACKEND_DEV_PORT = 8010;

/** In development the app is loaded from the PC's dev server; the backend runs on that same PC. */
function devHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "10.0.1.33:8081"
  if (hostUri) return hostUri.split(":")[0];
  const scriptURL: string | undefined = NativeModules.SourceCode?.scriptURL; // e.g. "http://10.0.1.33:8081/index.bundle?..."
  const match = scriptURL?.match(/^https?:\/\/([^:/]+)/);
  return match ? match[1] : null;
}

function resolveApiUrl(): string {
  if (__DEV__) {
    const host = devHost();
    // Follows the PC automatically when its Wi-Fi address changes.
    if (host && host !== "localhost") return `http://${host}:${BACKEND_DEV_PORT}`;
  }
  // Release builds: set EXPO_PUBLIC_API_URL (e.g. https://call.example.com) in eas.json.
  return (process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:8000").replace(/\/$/, "");
}

export const API_URL = resolveApiUrl();
