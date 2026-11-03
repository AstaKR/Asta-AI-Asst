import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "../types";
import { activeSegmentIndex, checkUploadFile, formatClock, isProcessing, pickRecorderFormat, searchSegments } from "./meetings";

const seg = (index: number, start_ms: number, original_text: string, translated_text = ""): TranscriptSegment => ({
  index,
  start_ms,
  end_ms: start_ms + 1000,
  speaker: "",
  language: "ta",
  original_text,
  translated_text,
  translation_language: "",
  origin: "asr",
  edited_at: null,
});

describe("meeting helpers", () => {
  it("formats timestamps", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_400)).toBe("01:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });

  it("finds the segment playing at a time", () => {
    const segs = [seg(0, 0, "a"), seg(1, 2800, "b"), seg(2, 9000, "c")];
    expect(activeSegmentIndex(segs, 100)).toBe(0);
    expect(activeSegmentIndex(segs, 3000)).toBe(1);
    expect(activeSegmentIndex(segs, 20_000)).toBe(2);
    expect(activeSegmentIndex([seg(0, 500, "a")], 100)).toBeNull();
  });

  it("searches original and translated text", () => {
    const segs = [seg(0, 0, "வணக்கம் ரவி", "Hello Ravi"), seg(1, 1000, "बजट", "Budget")];
    expect(searchSegments(segs, "ravi").map((s) => s.index)).toEqual([0]);
    expect(searchSegments(segs, "बजट").map((s) => s.index)).toEqual([1]);
    expect(searchSegments(segs, "  ")).toHaveLength(2);
  });

  it("picks a supported recording format", () => {
    expect(pickRecorderFormat((m) => m.startsWith("audio/webm"))).toEqual({ mime: "audio/webm;codecs=opus", ext: "webm" });
    expect(pickRecorderFormat((m) => m === "audio/mp4")).toEqual({ mime: "audio/mp4", ext: "m4a" });
    expect(pickRecorderFormat(() => false)).toBeNull();
  });

  it("pre-checks uploads", () => {
    const config = { allowed_extensions: [".wav", ".mp3", ".m4a"], max_upload_mb: 1 };
    expect(checkUploadFile({ name: "a.MP3", size: 10 }, config)).toBeNull();
    expect(checkUploadFile({ name: "a.exe", size: 10 }, config)).toMatch(/Unsupported/);
    expect(checkUploadFile({ name: "a.wav", size: 0 }, config)).toMatch(/empty/);
    expect(checkUploadFile({ name: "a.wav", size: 2 * 1024 * 1024 }, config)).toMatch(/larger/);
  });

  it("knows processing states", () => {
    expect(isProcessing("transcribing")).toBe(true);
    expect(isProcessing("completed")).toBe(false);
  });
});
