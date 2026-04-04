// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BADGED_FAVICON_DATA_URL,
  BROWSER_PREVIEW_BADGE_ATTR,
  useBrowserPreviewBadge,
} from "@/lib/useBrowserPreviewBadge";

function TestHarness({ active }: { active: boolean }) {
  useBrowserPreviewBadge(active);
  return null;
}

describe("useBrowserPreviewBadge", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalIcon: HTMLLinkElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.head.innerHTML = "";
    document.body.innerHTML = "";

    originalIcon = document.createElement("link");
    originalIcon.rel = "icon";
    originalIcon.href = "/icon.svg";
    document.head.appendChild(originalIcon);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("badges the existing favicon link in place", () => {
    act(() => {
      root.render(<TestHarness active={true} />);
    });

    expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
    expect(originalIcon.getAttribute(BROWSER_PREVIEW_BADGE_ATTR)).toBe("true");
    expect(originalIcon.href).toBe(BADGED_FAVICON_DATA_URL);
    expect(originalIcon.type).toBe("image/svg+xml");
    expect(originalIcon.getAttribute("sizes")).toBe("any");
  });

  it("restores the original favicon when the badge is cleared", () => {
    act(() => {
      root.render(<TestHarness active={true} />);
    });

    act(() => {
      root.render(<TestHarness active={false} />);
    });

    expect(
      document.head.querySelectorAll(`link[${BROWSER_PREVIEW_BADGE_ATTR}="true"]`),
    ).toHaveLength(0);
    expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
    expect(originalIcon.getAttribute("href")).toBe("/icon.svg");
  });

  it("re-badges a replacement favicon link after head reconciliation", async () => {
    act(() => {
      root.render(<TestHarness active={true} />);
    });

    const replacementIcon = document.createElement("link");
    replacementIcon.rel = "icon";
    replacementIcon.href = "/icon.svg?replacement=1";
    originalIcon.replaceWith(replacementIcon);

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
    expect(replacementIcon.getAttribute(BROWSER_PREVIEW_BADGE_ATTR)).toBe("true");
    expect(replacementIcon.href).toBe(BADGED_FAVICON_DATA_URL);

    act(() => {
      root.render(<TestHarness active={false} />);
    });

    expect(replacementIcon.getAttribute("href")).toBe("/icon.svg?replacement=1");
    expect(replacementIcon.hasAttribute(BROWSER_PREVIEW_BADGE_ATTR)).toBe(false);
  });

  it("creates and later removes a fallback favicon when none exists", () => {
    originalIcon.remove();

    act(() => {
      root.render(<TestHarness active={true} />);
    });

    const iconsWhileActive = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    expect(iconsWhileActive).toHaveLength(1);
    expect(iconsWhileActive[0]?.getAttribute(BROWSER_PREVIEW_BADGE_ATTR)).toBe("true");

    act(() => {
      root.render(<TestHarness active={false} />);
    });

    expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(0);
  });
});
