import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, quickApi } from "../api";
import type { QuickResult } from "../types";

const MIN_MS = 400;

/**
 * Hold-to-talk translation: record while the button is held, send the clip to the backend
 * (Sarvam speech-to-text → translate → speech) and play the translated voice.
 */
export function useQuickTranslate(maxSeconds = 30) {
  // Mono 64 kbps AAC keeps a 30 s clip well under the 2 MB upload limit.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 });
  const [recording, setRecording] = useState<string | null>(null); // key of the side that is recording
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const startedAt = useRef(0);
  // Refs, not state: the time-limit callback runs with the closure from when recording started.
  const active = useRef<string | null>(null);
  const working = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useRef<AudioPlayer | null>(null);

  useEffect(
    () => () => {
      player.current?.remove();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const play = useCallback(async (result: QuickResult) => {
    if (!result.audio) return;
    const file = new File(Paths.cache, `quick-${Date.now()}.wav`);
    file.create();
    file.write(result.audio, { encoding: "base64" });
    player.current?.remove();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const p = createAudioPlayer({ uri: file.uri });
    player.current = p;
    const sub = p.addListener("playbackStatusUpdate", (s) => {
      if (!s.didJustFinish) return;
      sub.remove();
      if (file.exists) file.delete();
    });
    p.play();
  }, []);

  const start = useCallback(
    /** onTimeLimit runs when the clip reaches maxSeconds (it should call stop()). */
    async (key: string, onTimeLimit: () => void) => {
      if (active.current || working.current) return;
      setError("");
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission is required. Enable it in Settings → Apps.");
        return;
      }
      player.current?.pause();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      active.current = key;
      startedAt.current = Date.now();
      setRecording(key);
      timer.current = setTimeout(onTimeLimit, maxSeconds * 1000);
    },
    [recorder, maxSeconds],
  );

  /** Stops recording and translates. Returns null when nothing usable was said. */
  const stop = useCallback(
    async (fields: { source_language: string; target_language: string; speak: boolean; transcribe_only?: boolean }): Promise<QuickResult | null> => {
      const key = active.current;
      if (!key) return null;
      active.current = null;
      if (timer.current) clearTimeout(timer.current);
      await recorder.stop();
      setRecording(null);
      const uri = recorder.uri;
      if (!uri || Date.now() - startedAt.current < MIN_MS) {
        setError("Hold the button while you speak.");
        return null;
      }
      setBusy(key);
      working.current = true;
      try {
        const result = await quickApi.speech(fields, { uri, name: "speech.m4a", type: "audio/mp4" });
        if (fields.speak) await play(result);
        return result;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Translation failed");
        return null;
      } finally {
        working.current = false;
        setBusy(null);
        const f = new File(uri);
        if (f.exists) f.delete();
      }
    },
    [recorder, play],
  );

  return { start, stop, play, recording, busy, error, setError };
}
