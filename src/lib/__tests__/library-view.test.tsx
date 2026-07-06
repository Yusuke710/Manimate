// @vitest-environment jsdom

import { act, createElement } from "react";
import type { ReactEventHandler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryView } from "@/components/LibraryView";
import { matchesLibrarySearch } from "@/lib/library-search";

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
    plan_content: "Explain attention with highlighted tokens.",
    script_content: "class AttentionScene(Scene): pass",
    aspect_ratio: "16:9",
    created_at: "2026-05-12T01:00:00.000Z",
    updated_at: "2026-05-12T01:00:00.000Z",
  },
  {
    id: "session-2",
    session_number: 8,
    title: "A geometry video",
    status: "completed",
    has_video: true,
    last_video_url: "/api/files?session_id=session-2",
    plan_content: "Draw a triangle proof.",
    script_content: "class GeometryScene(Scene): pass",
    aspect_ratio: "16:9",
    created_at: "2026-05-13T01:00:00.000Z",
    updated_at: "2026-05-13T01:00:00.000Z",
  },
];

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function updateInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("LibraryView", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;
  let openMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    // Emulates /api/sessions?full=1[&q=…]: search happens server-side with
    // matchesLibrarySearch; plan/script content stays on the "server" (the
    // fixture) and is never part of the response the component sees.
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const q = new URL(String(input), "http://localhost").searchParams.get("q");
      const visible = sessions.map(({ plan_content, script_content, ...session }) => {
        void plan_content;
        void script_content;
        return session;
      });
      if (!q) return Response.json(visible);
      return Response.json(
        visible.filter((_, index) => matchesLibrarySearch(sessions[index], q))
      );
    });
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

  it("filters library videos by fuzzy plan and code matches", async () => {
    const onSessionSelect = vi.fn();

    await act(async () => {
      root?.render(<LibraryView onSessionSelect={onSessionSelect} />);
    });
    await flushEffects();

    expect(container?.textContent).toContain("A generated video");
    expect(container?.textContent).toContain("A geometry video");

    const search = container?.querySelector('input[type="search"]') as HTMLInputElement | null;
    expect(search).not.toBeNull();
    if (!search) throw new Error("Expected search input");

    await act(async () => {
      updateInputValue(search, "attenton");
    });

    expect(container?.textContent).toContain("A generated video");
    expect(container?.textContent).not.toContain("A geometry video");

    await act(async () => {
      updateInputValue(search, "GeometryScene");
    });

    expect(container?.textContent).not.toContain("A generated video");
    expect(container?.textContent).toContain("A geometry video");
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

describe("matchesLibrarySearch", () => {
  const record = {
    title: "Transformer explainer",
    plan_content: "Introduce attention weights with highlighted tokens.",
    script_content: "class AttentionScene(Scene): pass",
  };

  it("matches title, plan, and script content", () => {
    expect(matchesLibrarySearch(record, "transformer")).toBe(true);
    expect(matchesLibrarySearch(record, "weights")).toBe(true);
    expect(matchesLibrarySearch(record, "AttentionScene")).toBe(true);
  });

  it("matches likely misspellings in longer tokens", () => {
    expect(matchesLibrarySearch(record, "attenton")).toBe(true);
    expect(matchesLibrarySearch(record, "atention")).toBe(true);
  });

  it("requires every query token to match", () => {
    expect(matchesLibrarySearch(record, "attention tokens")).toBe(true);
    expect(matchesLibrarySearch(record, "attention planets")).toBe(false);
  });
});
