// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ImageLightbox from "@/components/ImageLightbox";

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ImageLightbox keyboard navigation", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    });

    HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not navigate images with arrow keys while the annotation note is focused", async () => {
    const onIndexChange = vi.fn();

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }, { url: "/second.png" }]}
          index={0}
          onIndexChange={onIndexChange}
          onClose={vi.fn()}
          onImageChange={vi.fn()}
          onAnnotationConfirm={vi.fn()}
        />,
      );
    });
    await flushEffects();

    const noteInput = document.querySelector<HTMLInputElement>('input[aria-label="Frame instruction"]');
    expect(noteInput).not.toBeNull();
    if (!noteInput) throw new Error("Expected frame instruction input");

    noteInput.focus();

    noteInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }));

    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("navigates images with arrow keys outside editable fields", async () => {
    const onIndexChange = vi.fn();

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }, { url: "/second.png" }]}
          index={0}
          onIndexChange={onIndexChange}
          onClose={vi.fn()}
          onImageChange={vi.fn()}
          onAnnotationConfirm={vi.fn()}
        />,
      );
    });
    await flushEffects();

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }));

    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
});
