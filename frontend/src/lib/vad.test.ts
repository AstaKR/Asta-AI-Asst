import { describe, expect, it } from "vitest";

import { createTurnDetector, levelDb } from "./vad";

/** Feeds `ms` of a constant level in 50 ms steps; returns the events that fired. */
function feed(d: ReturnType<typeof createTurnDetector>, level: number, ms: number, clock: { t: number }) {
  const events: string[] = [];
  for (let i = 0; i < ms; i += 50) {
    clock.t += 50;
    const e = d.push(level, clock.t);
    if (e) events.push(e);
  }
  return events;
}

describe("createTurnDetector", () => {
  it("detects one spoken turn after a quiet room", () => {
    const d = createTurnDetector();
    const clock = { t: 0 };
    expect(feed(d, -65, 1000, clock)).toEqual([]);
    expect(feed(d, -25, 1500, clock)).toEqual(["start"]);
    expect(d.speaking).toBe(true);
    expect(feed(d, -65, 1000, clock)).toEqual(["end"]);
    expect(d.speaking).toBe(false);
  });

  it("keeps the turn open through short pauses between words", () => {
    const d = createTurnDetector({ endSilenceMs: 900 });
    const clock = { t: 0 };
    feed(d, -65, 500, clock);
    expect(feed(d, -25, 600, clock)).toEqual(["start"]);
    expect(feed(d, -65, 500, clock)).toEqual([]);
    expect(feed(d, -25, 600, clock)).toEqual([]);
    expect(feed(d, -65, 1000, clock)).toEqual(["end"]);
  });

  it("drops a short click", () => {
    const d = createTurnDetector({ minSpeechMs: 400 });
    const clock = { t: 0 };
    feed(d, -65, 500, clock);
    expect([...feed(d, -25, 200, clock), ...feed(d, -65, 1000, clock)]).toEqual(["start", "discard"]);
  });

  it("follows a noisy room: steady fan noise is not speech", () => {
    const d = createTurnDetector();
    const clock = { t: 0 };
    feed(d, -40, 8000, clock); // a fan switched on: may first look like one turn, then becomes the noise floor
    expect(d.threshold).toBeGreaterThan(-40);
    expect(feed(d, -40, 2000, clock)).toEqual([]);
    expect(feed(d, -15, 800, clock)).toEqual(["start"]);
  });

  it("ends a turn that runs too long", () => {
    const d = createTurnDetector({ maxTurnMs: 3000 });
    const clock = { t: 0 };
    feed(d, -65, 500, clock);
    // A long monologue is cut into turns of at most maxTurnMs.
    expect(feed(d, -25, 4000, clock)).toEqual(["start", "end", "start"]);
  });
});

describe("levelDb", () => {
  it("measures full scale and silence", () => {
    expect(levelDb(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(0);
    expect(levelDb(new Float32Array(4))).toBe(-100);
  });
});
