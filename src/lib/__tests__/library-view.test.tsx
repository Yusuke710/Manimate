// @vitest-environment jsdom

import { act, createElement } from "react";
import type { ReactEventHandler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryView } from "@/components/LibraryView";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    onError,
  }: {
    alt: string;
    src: string;
    onError?: ReactEventHandler<HTMLImageElement>;
  }) => createElement("img", { alt, src, onError }),
}));

const sessions = [
  {
    id: "session-1",
    session_number: 7,
    title: "A generated video",
    status: "completed",
    has_video: true,
    last_video_url: "/api/files?session_id=session-1",
    aspect_ratio: "16:9",
    created_at: "2026-05-12T01:00:00.000Z",
    updated_at: "2026-05-12T01:00:00.000Z",
  },
];

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("LibraryView", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;
  let openMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    fetchMock = vi.fn(async () => Response.json(sessions));
    openMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "open", {
      configurable: true,
      value: openMock,
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
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens a library video session on single click", async () => {
    const onSessionSelect = vi.fn();

    await act(async () => {
      root?.render(<LibraryView onSessionSelect={onSessionSelect} />);
    });
    await flushEffects();

    const card = container?.querySelector("a[title]") as HTMLAnchorElement | null;
    expect(card).not.toBeNull();
    expect(card?.getAttribute("href")).toBe("/?session=session-1");

    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(220);
    });

    expect(onSessionSelect).toHaveBeenCalledWith("session-1");
    expect(openMock).not.toHaveBeenCalled();
  });

  it("opens a library video session in a new tab on double click", async () => {
    const onSessionSelect = vi.fn();

    await act(async () => {
      root?.render(<LibraryView onSessionSelect={onSessionSelect} />);
    });
    await flushEffects();

    const card = container?.querySelector("a[title]") as HTMLAnchorElement | null;
    expect(card).not.toBeNull();
    expect(card?.getAttribute("href")).toBe("/?session=session-1");

    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      card?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(220);
    });

    expect(onSessionSelect).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(
      "/?session=session-1",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
