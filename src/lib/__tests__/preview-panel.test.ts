import { describe, expect, it } from "vitest";
import { getPreviewPlaybackSnapshot } from "@/components/PreviewPanel";

describe("getPreviewPlaybackSnapshot", () => {
  it("hydrates playback state from an already-loaded video element", () => {
    const snapshot = getPreviewPlaybackSnapshot({
      currentTime: 14.5,
      duration: 92.2,
      paused: false,
      ended: false,
      playbackRate: 1.25,
    });

    expect(snapshot).toEqual({
      currentTime: 14.5,
      duration: 92.2,
      isPlaying: true,
      isEnded: false,
      playbackSpeed: 1.25,
      isPaused: false,
    });
  });

  it("falls back safely when metadata values are not usable yet", () => {
    const snapshot = getPreviewPlaybackSnapshot({
      currentTime: Number.NaN,
      duration: Number.NaN,
      paused: true,
      ended: false,
      playbackRate: 0,
    });

    expect(snapshot).toEqual({
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      isEnded: false,
      playbackSpeed: 1,
      isPaused: true,
    });
  });
});
