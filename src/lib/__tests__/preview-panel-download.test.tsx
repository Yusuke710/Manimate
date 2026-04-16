// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewTab } from "@/components/PreviewPanel";

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

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PreviewTab download flow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/subtitles?session_id=session-1")) {
        return new Response("", { status: 404 });
      }
      if (url.includes("/api/chapters?session_id=session-1")) {
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/files?video=rendered")) {
        return new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    window.matchMedia = vi.fn().mockImplementation(() => createMatchMediaResult(false)) as typeof window.matchMedia;
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    Object.defineProperty(HTMLElement.prototype, "click", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "open", {
      configurable: true,
      value: vi.fn(),
    });

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
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("auto-downloads the rendered HQ file after the new preview arrives", async () => {
    const onRequestHqRender = vi.fn(() => true);

    await act(async () => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=1"
          videoRefreshNonce={0}
          sandboxId="session-1"
          sessionId="session-1"
          sessionModel="gpt-5.4"
          isRendering={false}
          onRequestHqRender={onRequestHqRender}
        />,
      );
    });

    const trigger = container?.querySelector('[data-testid="download-trigger"]') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const hqOption = container?.querySelector('[data-testid="download-quality-hq"]') as HTMLDivElement | null;
    expect(hqOption).not.toBeNull();
    await act(async () => {
      hqOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirm = container?.querySelector('[data-testid="download-confirm"]') as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRequestHqRender).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/files?video=rendered", { cache: "no-store" });

    await act(async () => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=1"
          videoRefreshNonce={0}
          sandboxId="session-1"
          sessionId="session-1"
          sessionModel="gpt-5.4"
          isRendering
          onRequestHqRender={onRequestHqRender}
        />,
      );
    });

    await act(async () => {
      root?.render(
        <PreviewTab
          videoUrl="/api/files?video=rendered"
          videoRefreshNonce={1}
          sandboxId="session-1"
          sessionId="session-1"
          sessionModel="gpt-5.4"
          isRendering={false}
          onRequestHqRender={onRequestHqRender}
        />,
      );
    });

    await flushEffects();
    await flushEffects();
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledWith("/api/files?video=rendered", { cache: "no-store" });
  });
});
