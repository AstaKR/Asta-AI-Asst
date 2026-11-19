import type { Contact } from "../types";

/** The letters on each phone key, as on an old handset (1 and 0 have none). */
export const KEY_LETTERS: Record<string, string> = { "1": "", "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "", "+": "" };

const LETTER_TO_DIGIT: Record<string, string> = {};
for (const [digit, letters] of Object.entries(KEY_LETTERS)) for (const l of letters) LETTER_TO_DIGIT[l.toLowerCase()] = digit;

/** "Ravi" → "7284": the digits you would press to spell it. Letters we do not know (Tamil, Hindi…) are skipped. */
export function toKeys(text: string): string {
  return Array.from(text.toLowerCase())
    .map((ch) => (/[0-9+]/.test(ch) ? ch : (LETTER_TO_DIGIT[ch] ?? "")))
    .join("");
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/**
 * Contacts that match what has been typed so far. Digits match a name spelled on the keys (starting at the name or at
 * any word in it), a username spelled on the keys, or part of a saved mobile number. Letters match by plain text.
 * Favourites and the people you call most come first.
 */
export function matchContacts(contacts: Contact[], typed: string, limit = 4): Contact[] {
  const q = typed.trim();
  if (!q) return [];
  const numeric = /^[0-9+\s]+$/.test(q);
  const digits = q.replace(/\s/g, "");
  const needle = q.toLowerCase();

  const hit = (c: Contact): boolean => {
    if (numeric) {
      const words = c.name.split(/\s+/).map(toKeys);
      if (toKeys(c.name).startsWith(digits) || words.some((w) => w.startsWith(digits))) return true;
      if (toKeys(c.username).startsWith(digits)) return true;
      const number = onlyDigits(c.target);
      return digits.replace("+", "").length >= 3 && number.includes(onlyDigits(digits));
    }
    return c.name.toLowerCase().includes(needle) || c.username.toLowerCase().includes(needle) || c.target.toLowerCase().includes(needle);
  };

  return contacts
    .filter(hit)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.call_count - a.call_count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Colour for a person's avatar, stable for the same name. */
const AVATARS = ["bg-saffron", "bg-mist", "bg-blush", "bg-butter", "bg-[#c9e2cf]", "bg-[#e8c9de]"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export const initialOf = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();
