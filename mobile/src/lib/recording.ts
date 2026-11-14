import { RecordingPresets, type RecordingOptions } from "expo-audio";

/**
 * Microphone settings for speech recognition. 16 kHz mono is what the recogniser works on, so it
 * gets a clean signal without a resampling step. On Android the `voice_recognition` source applies
 * the phone's noise suppression and gain tuned for speech (it is ignored on iOS).
 */
export const SPEECH_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: "voice_recognition" },
};

/** Speakers stop talking a beat before they tap "stop"; keep recording a moment so the last word is not cut. */
export const TAIL_MS = 350;
