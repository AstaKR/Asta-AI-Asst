import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, quickApi } from "../api";
import { createTurnDetector } from "../lib/vad";
import type { QuickResult } from "../types";

const TICK_MS = 100;
const IDLE_RESTART_MS = 20000;

/**
 * Hands-free conversation: the phone listens continuously, cuts a turn when the speaker pauses,
 * sends it with the two languages (the server detects which one was spoken and translates into the
 * other), plays the translation, then listens again. It does not listen while the translation plays.
 */
export function useHandsFree(onResult: (r: QuickResult) => void) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true });
  const [listening, setListening] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(-160);
  const [error, setError] = useState("");
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const playAndWait = (r: QuickResult) =>
    new Promise<void>((resolve) => {
      if (!r.audio) return resolve();
      const file = new File(Paths.cache, `handsfree-${Date.now()}.wav`);
      file.create();
      file.write(r.audio, { encoding: "base64" });
      const p = createAudioPlayer({ uri: file.uri });
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        sub.remove();
        p.remove();
        if (file.exists) file.delete();
        resolve();
      };
      const sub = p.addListener("playbackStatusUpdate", (s) => s.didJustFinish && done());
      p.play();
      setTimeout(done, 60000); // never hang if the player reports nothing
    });

  const listen = useCallback(
    async (pair: string, speak: boolean) => {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      const detector = createTurnDetector({ minThresholdDb: -45 });
      let restartAt = Date.now() + IDLE_RESTART_MS;
      let working = false;

      timer.current = setInterval(async () => {
        if (working || !active.current) return;
        const db = recorder.getStatus().metering ?? -160;
        setLevel(db);
        const event = detector.push(db, Date.now());
        if (event === "start") setHearing(true);
        if (event !== "end" && event !== "discard") {
          if (!detector.speaking && Date.now() > restartAt) {
            // Long silence: begin a fresh file so it does not grow forever.
            working = true;
            await recorder.stop();
            await recorder.prepareToRecordAsync();
            recorder.record();
            restartAt = Date.now() + IDLE_RESTART_MS;
            working = false;
          }
          return;
        }
        working = true;
        setHearing(false);
        await recorder.stop();
        const uri = recorder.uri;
        if (event === "end" && uri) {
          setBusy(true);
          try {
            const r = await quickApi.speech(
              { source_language: "auto", target_language: pair.split(",")[1], speak, pair },
              { uri, name: "speech.m4a", type: "audio/mp4" },
            );
            setError("");
            onResultRef.current(r);
            if (speak) {
              await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
              await playAndWait(r);
            }
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Translation failed");
          } finally {
            setBusy(false);
            const f = new File(uri);
            if (f.exists) f.delete();
          }
        }
        detector.reset();
        if (!active.current) return;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        restartAt = Date.now() + IDLE_RESTART_MS;
        working = false;
      }, TICK_MS);
    },
    [recorder],
  );

  const start = useCallback(
    async (pair: string, speak: boolean) => {
      if (active.current) return;
      setError("");
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Microphone permission is required. Enable it in Settings → Apps.");
        return;
      }
      active.current = true;
      setListening(true);
      await listen(pair, speak);
    },
    [listen],
  );

  const stop = useCallback(async () => {
    active.current = false;
    stopTimer();
    setListening(false);
    setHearing(false);
    setLevel(-160);
    if (recorder.getStatus().isRecording) await recorder.stop().catch(() => undefined);
  }, [recorder]);

  useEffect(
    () => () => {
      active.current = false;
      stopTimer();
    },
    [],
  );

  return { start, stop, listening, hearing, busy, level, error, setError };
}
