// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AspectRatio } from "@/lib/aspect-ratio";
import {
  ASPECT_RATIO_PREF_KEY,
  usePreferredAspectRatio,
} from "@/lib/usePreferredAspectRatio";

function TestHarness({ overrideRatio }: { overrideRatio?: AspectRatio }) {
  const [ratio, setRatio] = usePreferredAspectRatio();

  useEffect(() => {
    if (!overrideRatio) return;
    setRatio(overrideRatio);
  }, [overrideRatio, setRatio]);

  return <div data-testid="ratio">{ratio}</div>;
}

describe("usePreferredAspectRatio", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("restores the saved ratio when no newer selection is made", () => {
    localStorage.setItem(ASPECT_RATIO_PREF_KEY, "9:16");

    act(() => {
      root.render(<TestHarness />);
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(container.querySelector('[data-testid="ratio"]')?.textContent).toBe("9:16");
  });

  it("does not let the saved ratio override a newer explicit selection", () => {
    localStorage.setItem(ASPECT_RATIO_PREF_KEY, "9:16");

    act(() => {
      root.render(<TestHarness overrideRatio="16:9" />);
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(container.querySelector('[data-testid="ratio"]')?.textContent).toBe("16:9");
    expect(localStorage.getItem(ASPECT_RATIO_PREF_KEY)).toBe("16:9");
  });
});
