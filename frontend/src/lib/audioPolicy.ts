/**
 * Decides how loudly to play the other person's ORIGINAL voice.
 *
 * - If they speak the language I listen in, there is no translation: play them at full volume.
 * - If translation is active for me, duck the original under the translated voice
 *   (user preference, default 15%) so tone and turn-taking are still audible.
 * - If translation should happen but is not available (translator absent, disabled, limit reached),
 *   fall back to the original at full volume so the call still works.
 */
export interface AudioPolicyInput {
  otherSpokenLanguage?: string;
  myListenLanguage?: string;
  translatorAvailable: boolean;
  originalVoiceVolume: number; // 0-100
}

export function needsTranslation(otherSpoken?: string, myListen?: string): boolean {
  return Boolean(otherSpoken && myListen && otherSpoken !== myListen);
}

export function originalVolume({
  otherSpokenLanguage,
  myListenLanguage,
  translatorAvailable,
  originalVoiceVolume,
}: AudioPolicyInput): number {
  if (!needsTranslation(otherSpokenLanguage, myListenLanguage)) return 1;
  if (!translatorAvailable) return 1;
  return Math.max(0, Math.min(100, originalVoiceVolume)) / 100;
}

/** The only translated track I should ever play is the one addressed to me. */
export function isMyTranslationTrack(trackName: string | undefined, myIdentity: string): boolean {
  return trackName === `translation-for-${myIdentity}`;
}

/** A speaker's effective language: the detected one when their profile says "auto" (phone callers). */
export function effectiveLanguage(attribute: string | undefined, detected: string | undefined): string | undefined {
  return !attribute || attribute === "auto" ? detected : attribute;
}

/**
 * A phone caller cannot turn down my original voice, so while translation for them is working,
 * only the translator agent may receive my microphone; the caller then hears just the translation.
 * Returns null for "everyone may subscribe".
 */
export function micAllowedIdentities(opts: {
  otherIsPhone: boolean;
  translationForOtherActive: boolean;
  agentIdentities: string[];
}): string[] | null {
  if (!opts.otherIsPhone || !opts.translationForOtherActive || opts.agentIdentities.length === 0) return null;
  return opts.agentIdentities;
}
