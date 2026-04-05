// @vitest-environment jsdom

import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ChatPanel } from "@/app/HomeClient";

describe("welcome session transition", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    Object.defineProperty(Element.prototype, "scrollIntoView", {
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
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("shows the pending welcome prompt on the first committed session render", () => {
    const consumeWelcomePayload = vi.fn(() => ({
      prompt: "Animate the unit circle with a moving sine wave",
    }));

    flushSync(() => {
      root?.render(
        <ChatPanel
          sessionId="session-1"
          aspectRatio="16:9"
          hasPendingWelcomePayload={() => true}
          consumeWelcomePayload={consumeWelcomePayload}
          sessionReady={new Promise<boolean>(() => {})}
        />,
      );
    });

    expect(consumeWelcomePayload).toHaveBeenCalledWith("session-1");
    expect(container?.textContent).toContain(
      "Animate the unit circle with a moving sine wave",
    );
    expect(container?.textContent).toContain("Working...");
    expect(container?.textContent).not.toContain("Messages will appear here");
    expect(container?.querySelectorAll('[data-testid="message-user"]')).toHaveLength(1);
  });
});
