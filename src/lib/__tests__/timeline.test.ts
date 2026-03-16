import { describe, expect, it } from "vitest";

import {
  normalizeChaptersToVideoDuration,
  type TimelineChapter,
} from "../timeline";

describe("normalizeChaptersToVideoDuration", () => {
  it("extends the final chapter to match playable video duration when drift is small", () => {
    const chapters: TimelineChapter[] = [
      { name: "Intro", start: 0, duration: 9.133 },
      { name: "Main", start: 9.133, duration: 21.133 },
      { name: "Outro", start: 30.266, duration: 29.4 },
    ];

    const result = normalizeChaptersToVideoDuration(chapters, 60.92);

    expect(result).not.toBeNull();
    expect(result?.totalDuration).toBe(60.92);
    expect(result?.chapters[0]).toEqual(chapters[0]);
    expect(result?.chapters[1]).toEqual(chapters[1]);
    expect(result?.chapters[2]?.duration).toBeCloseTo(30.654, 3);
  });

  it("shrinks the final chapter when chapter timings slightly exceed video duration", () => {
    const chapters: TimelineChapter[] = [
      { name: "Part 1", start: 0, duration: 10 },
      { name: "Part 2", start: 10, duration: 10.8 },
    ];

    const result = normalizeChaptersToVideoDuration(chapters, 20);

    expect(result).not.toBeNull();
    expect(result?.chapters[1]?.duration).toBeCloseTo(10, 5);
  });

  it("rejects timelines when the drift is too large", () => {
    const chapters: TimelineChapter[] = [
      { name: "Part 1", start: 0, duration: 12 },
      { name: "Part 2", start: 12, duration: 12 },
    ];

    expect(normalizeChaptersToVideoDuration(chapters, 18)).toBeNull();
  });

  it("rejects single-chapter timelines", () => {
    const chapters: TimelineChapter[] = [
      { name: "Only", start: 0, duration: 12 },
    ];

    expect(normalizeChaptersToVideoDuration(chapters, 12)).toBeNull();
  });
});
