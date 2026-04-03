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

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.head.innerHTML = "";
    document.body.innerHTML = "";

    const originalIcon = document.createElement("link");
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

  it("appends managed favicon links when the badge becomes active", () => {
    act(() => {
      root.render(<TestHarness active={true} />);
    });

    const managedLinks = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>(
        `link[${BROWSER_PREVIEW_BADGE_ATTR}="true"]`,
      ),
    );

    expect(managedLinks).toHaveLength(2);
    expect(managedLinks.map((link) => link.rel)).toEqual(["icon", "shortcut icon"]);
    expect(managedLinks.every((link) => link.href === BADGED_FAVICON_DATA_URL)).toBe(true);
    expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(3);
  });

  it("removes managed favicon links when the badge is cleared", () => {
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
    expect(
      document.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute("href"),
    ).toBe("/icon.svg");
  });

  it("restores managed favicon links if head reconciliation removes them", async () => {
    act(() => {
      root.render(<TestHarness active={true} />);
    });

    Array.from(
      document.head.querySelectorAll<HTMLLinkElement>(
        `link[${BROWSER_PREVIEW_BADGE_ATTR}="true"]`,
      ),
    ).forEach((link) => link.remove());

    await act(async () => {
      await Promise.resolve();
    });

    const managedLinks = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>(
        `link[${BROWSER_PREVIEW_BADGE_ATTR}="true"]`,
      ),
    );

    expect(managedLinks).toHaveLength(2);
    expect(managedLinks.map((link) => link.rel)).toEqual(["icon", "shortcut icon"]);
  });
});
