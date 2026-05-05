// @vitest-environment jsdom

import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewTab } from "@/components/PreviewPanel";

interface MutableVideoState {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  playbackRate: number;
}

function createMatchMediaResult(matches: boolean) {
  return {
    matches,
    media: "",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function installVideoState(video: HTMLVideoElement, state: MutableVideoState): void {
  for (const key of Object.keys(state) as Array<keyof MutableVideoState>) {
    Object.defineProperty(video, key, {
      configurable: true,
      get: () => state[key],
      set: (value: MutableVideoState[typeof key]) => {
        state[key] = value;
      },
    });
  }
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("PreviewTab canplay hydration", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/subtitles?session_id=session-1")) {
          return new Response(
            "1\n00:00:00,000 --> 00:00:01,000\nHello world",
            { status: 200 },
          );
        }
        if (url.includes("/api/subtitles?session_id=session-single")) {
          return new Response(
            "1\n00:00:00,000 --> 00:00:01,000\nSingle scene",
            { status: 200 },
          );
        }
        if (url.includes("/api/chapters?session_id=session-1")) {
          return new Response(
            JSON.stringify([
              { name: "Intro", start: 0, duration: 10 },
              { name: "Outro", start: 10, duration: 10 },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (url.includes("/api/chapters?session_id=session-single")) {
          return new Response(
            JSON.stringify([
              { name: "Single Scene", start: 0, duration: 20 },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    window.matchMedia = vi.fn().mockImplementation(() => createMatchMediaResult(false)) as typeof window.matchMedia;
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.pause = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => {});

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("hydrates duration and progress from canplay when metadata events are missed", async () => {
    const onCanPlay = vi.fn();

    flushSync(() => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=1"
          videoRefreshNonce={0}
          sandboxId="session-1"
          sessionId="session-1"
          onCanPlay={onCanPlay}
        />,
      );
    });

    const video = container?.querySelector('[data-testid="video-player"]') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) throw new Error("Expected active video element");

    const videoState: MutableVideoState = {
      currentTime: 0,
      duration: 0,
      paused: true,
      ended: false,
      playbackRate: 1,
    };
    installVideoState(video, videoState);

    expect(container?.querySelectorAll('[data-testid="timeline-segment"]')).toHaveLength(0);

    videoState.currentTime = 5;
    videoState.duration = 20;
    videoState.paused = false;

    await act(async () => {
      video.dispatchEvent(new Event("canplay"));
    });

    await flushEffects();
    await flushEffects();

    expect(onCanPlay).toHaveBeenCalledTimes(1);
    expect(container?.querySelectorAll('[data-testid="timeline-segment"]')).toHaveLength(2);

    const handle = container?.querySelector('[data-testid="progress-handle"]') as HTMLDivElement | null;
    expect(handle).not.toBeNull();
    expect(handle?.className).toContain("scale-100");
    expect(handle?.style.left).toBe("calc(25% - 6px)");
  });

  it("keeps UI playback state synced from native media events", async () => {
    flushSync(() => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=1"
          videoRefreshNonce={0}
          sandboxId="session-1"
          sessionId="session-1"
        />,
      );
    });

    const video = container?.querySelector('[data-testid="video-player"]') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) throw new Error("Expected active video element");

    const videoState: MutableVideoState = {
      currentTime: 0,
      duration: 20,
      paused: true,
      ended: false,
      playbackRate: 1,
    };
    installVideoState(video, videoState);

    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    videoState.paused = false;
    await act(async () => {
      video.dispatchEvent(new Event("play"));
    });

    let handle = container?.querySelector('[data-testid="progress-handle"]') as HTMLDivElement | null;
    expect(handle?.className).toContain("scale-100");
    expect(container?.querySelector('[data-testid="play-toggle"] svg path[d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"]')).not.toBeNull();

    videoState.currentTime = 17;
    await act(async () => {
      video.dispatchEvent(new Event("timeupdate"));
    });

    handle = container?.querySelector('[data-testid="progress-handle"]') as HTMLDivElement | null;
    expect(handle?.style.left).toBe("calc(85% - 6px)");
    expect(container?.querySelector('[data-testid="current-time"]')?.textContent).toBe("0:17");
  });

  it("resyncs playback UI when the preview becomes visible again", async () => {
    flushSync(() => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=1"
          videoRefreshNonce={0}
          sandboxId="session-1"
          sessionId="session-1"
          isVisible={false}
        />,
      );
    });

    const video = container?.querySelector('[data-testid="video-player"]') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) throw new Error("Expected active video element");

    const videoState: MutableVideoState = {
      currentTime: 0,
      duration: 20,
      paused: true,
      ended: false,
      playbackRate: 1,
    };
    installVideoState(video, videoState);

    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    videoState.currentTime = 17;
    videoState.paused = false;

    flushSync(() => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=1"
          videoRefreshNonce={0}
          sandboxId="session-1"
          sessionId="session-1"
          isVisible
        />,
      );
    });

    await flushEffects();

    const handle = container?.querySelector('[data-testid="progress-handle"]') as HTMLDivElement | null;
    expect(handle?.className).toContain("scale-100");
    expect(handle?.style.left).toBe("calc(85% - 6px)");
    expect(container?.querySelector('[data-testid="current-time"]')?.textContent).toBe("0:17");
    expect(container?.querySelector('[data-testid="play-toggle"] svg path[d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"]')).not.toBeNull();
  });

  it("keeps the capture-frame button visible for single-chapter videos", async () => {
    flushSync(() => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=single"
          videoRefreshNonce={0}
          sandboxId="session-single"
          sessionId="session-single"
        />,
      );
    });

    const video = container?.querySelector('[data-testid="video-player"]') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) throw new Error("Expected active video element");

    const videoState: MutableVideoState = {
      currentTime: 0,
      duration: 20,
      paused: true,
      ended: false,
      playbackRate: 1,
    };
    installVideoState(video, videoState);

    await act(async () => {
      video.dispatchEvent(new Event("canplay"));
    });

    await flushEffects();
    await flushEffects();

    expect(container?.querySelector('[data-testid="capture-frame-button"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="capture-frame-button"]')?.textContent).toContain("Capture");
    expect(container?.textContent).not.toContain("Single Scene");
  });

  it("keeps the capture-frame button visible for single-chapter videos on mobile", async () => {
    window.matchMedia = vi.fn().mockImplementation(() => createMatchMediaResult(true)) as typeof window.matchMedia;

    flushSync(() => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=single"
          videoRefreshNonce={0}
          sandboxId="session-single"
          sessionId="session-single"
        />,
      );
    });

    const video = container?.querySelector('[data-testid="video-player"]') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) throw new Error("Expected active video element");

    const videoState: MutableVideoState = {
      currentTime: 0,
      duration: 20,
      paused: true,
      ended: false,
      playbackRate: 1,
    };
    installVideoState(video, videoState);

    await act(async () => {
      video.dispatchEvent(new Event("canplay"));
    });

    await flushEffects();
    await flushEffects();

    expect(container?.querySelector('[data-testid="capture-frame-button"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="capture-frame-button"]')?.textContent).toContain("Capture");
    expect(container?.textContent).not.toContain("Single Scene");
  });
});
