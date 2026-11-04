/**
 * Hands-free turn detection from microphone levels (dBFS), for face-to-face conversation.
 *
 * Speech starts when the level stays above the threshold for `startMs`; the turn ends after
 * `endSilenceMs` of quiet (or at `maxTurnMs`). The threshold follows the room's noise floor so a
 * fan or traffic does not count as speech. Turns shorter than `minSpeechMs` are dropped (coughs, clicks).
 */
export interface TurnDetectorOptions {
  minThresholdDb?: number; // never treat anything quieter than this as speech
  aboveNoiseDb?: number; // speech must be this much louder than the noise floor
  startMs?: number;
  endSilenceMs?: number;
  minSpeechMs?: number;
  maxTurnMs?: number;
}

export type TurnEvent = "start" | "end" | "discard" | null;

export function createTurnDetector(opts: TurnDetectorOptions = {}) {
  const o = { minThresholdDb: -50, aboveNoiseDb: 14, startMs: 150, endSilenceMs: 900, minSpeechMs: 400, maxTurnMs: 25000, ...opts };
  let noise = -60;
  let loudSince: number | null = null;
  let speechStart: number | null = null;
  let lastLoud = 0;
  let loudMs = 0;
  let lastT: number | null = null;

  return {
    get speaking() {
      return speechStart !== null;
    },
    get threshold() {
      return Math.max(o.minThresholdDb, noise + o.aboveNoiseDb);
    },
    reset() {
      loudSince = speechStart = lastT = null;
      loudMs = 0;
    },
    /** Feed one level reading; returns what happened. */
    push(levelDb: number, t: number): TurnEvent {
      const dt = lastT === null ? 0 : t - lastT;
      lastT = t;
      const loud = levelDb > Math.max(o.minThresholdDb, noise + o.aboveNoiseDb);
      // Noise floor: falls at once, rises slowly — and very slowly during a turn, so steady noise
      // (a fan switched on) ends up below the threshold instead of counting as endless speech.
      noise = levelDb < noise ? levelDb : noise + (levelDb - noise) * (speechStart === null ? 0.02 : 0.004);
      if (speechStart === null) {
        if (!loud) {
          loudSince = null;
          return null;
        }
        loudSince ??= t;
        if (t - loudSince < o.startMs) return null;
        speechStart = loudSince;
        lastLoud = t;
        loudMs = t - loudSince;
        return "start";
      }
      if (loud) {
        lastLoud = t;
        loudMs += dt;
      }
      const tooLong = t - speechStart >= o.maxTurnMs;
      if (t - lastLoud >= o.endSilenceMs || tooLong) {
        const enough = loudMs >= o.minSpeechMs;
        speechStart = loudSince = null;
        loudMs = 0;
        return enough ? "end" : "discard";
      }
      return null;
    },
  };
}

/** RMS level of time-domain samples (-1..1) in dBFS. */
export function levelDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}
