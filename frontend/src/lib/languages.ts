export const LANGUAGE_NAMES: Record<string, string> = {
  "ta-IN": "Tamil",
  "hi-IN": "Hindi",
  "en-IN": "English",
};

export const NATIVE_NAMES: Record<string, string> = {
  "ta-IN": "தமிழ்",
  "hi-IN": "हिन्दी",
  "en-IN": "English",
};

export function languageName(code: string | undefined): string {
  return (code && LANGUAGE_NAMES[code]) || code || "—";
}
