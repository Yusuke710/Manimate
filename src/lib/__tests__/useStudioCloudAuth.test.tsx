// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudAuthStatus } from "@/lib/studio-cloud-auth";
import { useStudioCloudAuth } from "@/lib/useStudioCloudAuth";

type HookSnapshot = ReturnType<typeof useStudioCloudAuth>;

function TestHarness({
  initialStatus,
  onRender,
}: {
  initialStatus: CloudAuthStatus;
  onRender: (snapshot: HookSnapshot) => void;
}) {
  onRender(useStudioCloudAuth(initialStatus));
  return null;
}

describe("useStudioCloudAuth", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("refreshes pending auth when the window regains focus", async () => {
    let snapshot: HookSnapshot | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/cloud-sync/status");
      return new Response(JSON.stringify({
        status: "connected",
        base_url: "https://manimate.ai",
        user_email: "youfu1202mo@gmail.com",
        user_name: "Yusuke Miyashita",
        device_name: "Yusukes-Laptop.lan",
        connected_at: "2026-04-05T00:00:03.000Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <TestHarness
          initialStatus={{
            status: "pending",
            base_url: "https://manimate.ai",
            code: "ABCD-EFGH",
            connect_url: "https://manimate.ai/connect/device/req-123",
            device_name: "Yusukes-Laptop.lan",
            expires_at: "2999-01-01T00:00:00.000Z",
          }}
          onRender={(nextSnapshot) => {
            snapshot = nextSnapshot;
          }}
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(snapshot?.cloudAuthStatus).toMatchObject({
      status: "connected",
      user_email: "youfu1202mo@gmail.com",
      user_name: "Yusuke Miyashita",
      device_name: "Yusukes-Laptop.lan",
    });
  });
});
