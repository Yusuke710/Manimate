import { describe, expect, it } from "vitest";
import {
  getFallbackSeekSeconds,
  getFallbackThumbnailArgs,
} from "@/lib/local/thumbnail";

describe("thumbnail fallback", () => {
  it("uses 25% of the video duration for the fallback seek time", () => {
    expect(getFallbackSeekSeconds(40)).toBe(10);
    expect(getFallbackSeekSeconds(35.85)).toBe(8.9625);
  });

  it("clamps invalid durations to the start of the video", () => {
    expect(getFallbackSeekSeconds(0)).toBe(0);
    expect(getFallbackSeekSeconds(-5)).toBe(0);
    expect(getFallbackSeekSeconds(Number.NaN)).toBe(0);
  });

  it("builds ffmpeg args for a single-frame capture at 25% duration", () => {
    expect(
      getFallbackThumbnailArgs("/tmp/video.mp4", "/tmp/thumbnail.jpg", 35.85)
    ).toEqual([
      "-y",
      "-ss", "8.963",
      "-i", "/tmp/video.mp4",
      "-frames:v", "1",
      "-update", "1",
      "-q:v", "3",
      "/tmp/thumbnail.jpg",
    ]);
  });
});
