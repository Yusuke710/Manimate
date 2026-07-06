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

  it("confirms the annotation when Enter is pressed in the note input", async () => {
    const onAnnotationConfirm = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }]}
          index={0}
          onIndexChange={vi.fn()}
          onClose={onClose}
          onImageChange={vi.fn()}
          onAnnotationConfirm={onAnnotationConfirm}
        />,
      );
    });
    await flushEffects();

    const noteInput = document.querySelector<HTMLInputElement>('input[aria-label="Frame instruction"]');
    expect(noteInput).not.toBeNull();
    if (!noteInput) throw new Error("Expected frame instruction input");

    await act(async () => {
      noteInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onAnnotationConfirm).toHaveBeenCalledWith(0, null, "");
    expect(onClose).toHaveBeenCalled();
  });

  it("confirms the annotation when Enter is pressed with the dialog focused", async () => {
    const onAnnotationConfirm = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }]}
          index={0}
          onIndexChange={vi.fn()}
          onClose={onClose}
          onImageChange={vi.fn()}
          onAnnotationConfirm={onAnnotationConfirm}
        />,
      );
    });
    await flushEffects();

    const dialog = document.querySelector<HTMLDialogElement>("dialog");
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error("Expected image lightbox dialog");

    dialog.focus();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onAnnotationConfirm).toHaveBeenCalledWith(0, null, "");
    expect(onClose).toHaveBeenCalled();
  });

  it("rolls back a click mark when the annotation canvas is double-clicked", async () => {
    const snapshot = {} as ImageData;
    const context = {
      beginPath: vi.fn(),
      getImageData: vi.fn(() => snapshot),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      putImageData: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }]}
          index={0}
          onIndexChange={vi.fn()}
          onClose={vi.fn()}
          onImageChange={vi.fn()}
          onAnnotationConfirm={vi.fn()}
        />,
      );
    });
    await flushEffects();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    expect(canvas).not.toBeNull();
    if (!canvas) throw new Error("Expected annotation canvas");

    canvas.getBoundingClientRect = vi.fn(() => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();

    const dispatchPointerEvent = (type: string, detail: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        detail,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      canvas.dispatchEvent(event);
    };

    await act(async () => {
      dispatchPointerEvent("pointerdown", 1);
      dispatchPointerEvent("pointerup", 1);
      dispatchPointerEvent("pointerdown", 2);
      dispatchPointerEvent("pointerup", 2);
      canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    expect(context.getImageData).toHaveBeenCalledTimes(1);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    expect(context.putImageData).toHaveBeenCalledWith(snapshot, 0, 0);
  });

  it("does not draw on the annotation canvas for right-clicks", async () => {
    const context = {
      beginPath: vi.fn(),
      getImageData: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }]}
          index={0}
          onIndexChange={vi.fn()}
          onClose={vi.fn()}
          onImageChange={vi.fn()}
          onAnnotationConfirm={vi.fn()}
        />,
      );
    });
    await flushEffects();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    expect(canvas).not.toBeNull();
    if (!canvas) throw new Error("Expected annotation canvas");

    canvas.getBoundingClientRect = vi.fn(() => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    canvas.setPointerCapture = vi.fn();

    const rightClick = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: 20,
      clientY: 20,
    });
    Object.defineProperty(rightClick, "pointerId", { value: 1 });

    await act(async () => {
      canvas.dispatchEvent(rightClick);
    });

    expect(context.getImageData).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
  });

  it("describes a red-stroke annotation with a trailing colon when the note is blank", async () => {
    const snapshot = {} as ImageData;
    const context = {
      beginPath: vi.fn(),
      getImageData: vi.fn(() => snapshot),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      putImageData: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["frame"], { type: "image/png" }));
    });
    const onAnnotationConfirm = vi.fn();

    await act(async () => {
      root?.render(
        <ImageLightbox
          images={[{ url: "/first.png" }]}
          index={0}
          onIndexChange={vi.fn()}
          onClose={vi.fn()}
          onImageChange={vi.fn()}
          onAnnotationConfirm={onAnnotationConfirm}
        />,
      );
    });
    await flushEffects();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    expect(canvas).not.toBeNull();
    if (!canvas) throw new Error("Expected annotation canvas");

    canvas.getBoundingClientRect = vi.fn(() => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();

    const dispatchPointerEvent = (type: string) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
        detail: 1,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      canvas.dispatchEvent(event);
    };

    await act(async () => {
      dispatchPointerEvent("pointerdown");
      dispatchPointerEvent("pointerup");
    });

    const applyButton = document.querySelector<HTMLButtonElement>('button[aria-label="Apply frame instruction"]');
    expect(applyButton).not.toBeNull();
    if (!applyButton) throw new Error("Expected apply frame instruction button");

    await act(async () => {
      applyButton.click();
    });

    expect(onAnnotationConfirm).toHaveBeenCalledWith(
      0,
      expect.any(File),
      "user annotation in red stroke:",
    );
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
