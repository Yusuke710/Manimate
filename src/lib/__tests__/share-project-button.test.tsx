// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShareProjectButton from "@/components/ShareProjectButton";

describe("ShareProjectButton", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      share_url: "https://manimate.ai/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      share_path: "/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      token: "OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });

    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("creates and copies the hosted share link returned by the local share route", async () => {
    await act(async () => {
      root?.render(<ShareProjectButton sessionId="session-1" />);
    });

    const trigger = container?.querySelector('[data-testid="share-project-trigger"]') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/share", {
      method: "POST",
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://manimate.ai/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
    );

    const input = container?.querySelector("input") as HTMLInputElement | null;
    expect(input?.value).toBe("https://manimate.ai/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy");
  });
});
