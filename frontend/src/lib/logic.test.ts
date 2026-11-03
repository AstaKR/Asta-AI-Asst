import { describe, expect, it } from "vitest";

import { effectiveLanguage, isMyTranslationTrack, micAllowedIdentities, needsTranslation, originalVolume } from "./audioPolicy";
import { initialTranslatorState, parseTranslatorMessage, translatorReducer, type TranslatorMessage } from "./translatorEvents";

describe("audio policy", () => {
  it("plays original at full volume when no translation is needed", () => {
    expect(originalVolume({ otherSpokenLanguage: "hi-IN", myListenLanguage: "hi-IN", translatorAvailable: true, originalVoiceVolume: 15 })).toBe(1);
  });
  it("ducks the original under the translation", () => {
    expect(originalVolume({ otherSpokenLanguage: "hi-IN", myListenLanguage: "ta-IN", translatorAvailable: true, originalVoiceVolume: 15 })).toBe(0.15);
  });
  it("falls back to the original when translation is unavailable", () => {
    expect(originalVolume({ otherSpokenLanguage: "hi-IN", myListenLanguage: "ta-IN", translatorAvailable: false, originalVoiceVolume: 0 })).toBe(1);
  });
  it("only accepts the translated track addressed to me", () => {
    expect(isMyTranslationTrack("translation-for-user-1", "user-1")).toBe(true);
    expect(isMyTranslationTrack("translation-for-user-2", "user-1")).toBe(false);
    expect(isMyTranslationTrack(undefined, "user-1")).toBe(false);
  });
  it("detects translation need", () => {
    expect(needsTranslation("ta-IN", "hi-IN")).toBe(true);
    expect(needsTranslation(undefined, "hi-IN")).toBe(false);
  });
});

describe("translator events", () => {
  const run = (msgs: TranslatorMessage[]) => msgs.reduce(translatorReducer, initialTranslatorState);

  it("builds a subtitle line from partial, final and translation", () => {
    const state = run([
      { type: "status", state: "ready", message: "AI translation is active" },
      { type: "subtitle", stage: "partial", utterance_id: "u1", speaker: "a", listener: "b", language: "ta-IN", text: "வண" },
      { type: "subtitle", stage: "final", utterance_id: "u1", speaker: "a", listener: "b", language: "ta-IN", text: "வணக்கம்" },
      { type: "subtitle", stage: "translation", utterance_id: "u1", speaker: "a", listener: "b", language: "hi-IN", text: "नमस्ते", original: "வணக்கம்" },
    ]);
    expect(state.availability).toBe("ready");
    expect(state.partialBySpeaker).toEqual({});
    expect(state.lines).toEqual([
      { id: "u1", speaker: "a", original: "வணக்கம்", originalLanguage: "ta-IN", translation: "नमस्ते", translationLanguage: "hi-IN", pending: false, skipped: false },
    ]);
  });

  it("tracks per-speaker activity and limits", () => {
    const state = run([
      { type: "status", state: "translating", speaker: "a" },
      { type: "status", state: "limit", speaker: "a", message: "per_call_tts_chars_limit" },
    ]);
    expect(state.activity.a).toBe("limit");
    expect(state.availability).toBe("limit");
  });

  it("parses only known messages", () => {
    expect(parseTranslatorMessage(new TextEncoder().encode('{"type":"metrics","utterance_id":"x","speaker":"a"}'))?.type).toBe("metrics");
    expect(parseTranslatorMessage("not json")).toBeNull();
    expect(parseTranslatorMessage('{"type":"evil"}')).toBeNull();
  });
});

describe("phone callers", () => {
  it("uses the detected language for auto speakers", () => {
    expect(effectiveLanguage("auto", "hi-IN")).toBe("hi-IN");
    expect(effectiveLanguage("ta-IN", "hi-IN")).toBe("ta-IN");
    expect(effectiveLanguage(undefined, undefined)).toBeUndefined();
  });
  it("restricts my microphone to the translator only for active phone translation", () => {
    expect(micAllowedIdentities({ otherIsPhone: true, translationForOtherActive: true, agentIdentities: ["agent-1"] })).toEqual(["agent-1"]);
    expect(micAllowedIdentities({ otherIsPhone: true, translationForOtherActive: false, agentIdentities: ["agent-1"] })).toBeNull();
    expect(micAllowedIdentities({ otherIsPhone: false, translationForOtherActive: true, agentIdentities: ["agent-1"] })).toBeNull();
    expect(micAllowedIdentities({ otherIsPhone: true, translationForOtherActive: true, agentIdentities: [] })).toBeNull();
  });
  it("records detected languages from final subtitles", () => {
    const state = translatorReducer(initialTranslatorState, {
      type: "subtitle", stage: "final", utterance_id: "u", speaker: "sip-1", listener: "a", language: "hi-IN", text: "x",
    });
    expect(state.languageBySpeaker).toEqual({ "sip-1": "hi-IN" });
  });
});
