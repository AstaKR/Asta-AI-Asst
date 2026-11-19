// Phone-style key sounds: each key plays the two-tone beep a real handset makes (DTMF).
const ROWS = [697, 770, 852, 941];
const COLS = [1209, 1336, 1477];
const LAYOUT: Record<string, [number, number]> = { "1": [0, 0], "2": [0, 1], "3": [0, 2], "4": [1, 0], "5": [1, 1], "6": [1, 2], "7": [2, 0], "8": [2, 1], "9": [2, 2], "+": [3, 0], "0": [3, 1], "back": [3, 2] };

const STORE = "dial_sound";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(STORE) !== "off";
  } catch {
    return true;
  }
}

export function setSound(on: boolean): void {
  try {
    localStorage.setItem(STORE, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

/** A short, soft beep for a key. Does nothing when sound is off or the browser has no audio. */
export function playKey(key: string): void {
  if (!soundOn() || !LAYOUT[key]) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const [r, c] = LAYOUT[key];
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    gain.connect(ctx.destination);
    for (const f of [ROWS[r], COLS[c]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch {
    /* audio blocked: stay silent */
  }
}
