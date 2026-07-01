"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";

interface LightboxImage {
  url: string;
  name?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (nextIndex: number) => void;
  onClose: () => void;
  onImageChange?: (index: number, file: File) => void;
  onAnnotationConfirm?: (index: number, file: File | null, note: string) => void;
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

const DRAW_COLOR = "#ff3b30";
const BRUSH_SIZE = 4;
const CLICK_STROKE_MOVEMENT_THRESHOLD = 2;

interface CanvasPoint {
  x: number;
  y: number;
}

export default function ImageLightbox({ images, index, onIndexChange, onClose, onImageChange, onAnnotationConfirm }: ImageLightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCloseRef = useRef(onClose);
  const closeWithAnnotationRef = useRef<() => void>(() => {});
  const isDrawingRef = useRef(false);
  const strokeStartPointRef = useRef<CanvasPoint | null>(null);
  const strokeMovedRef = useRef(false);
  const currentStrokeSnapshotRef = useRef<ImageData | null>(null);
  const lastClickStrokeSnapshotRef = useRef<ImageData | null>(null);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [note, setNote] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const count = images.length;
  const currentIndex = wrapIndex(index, count);
  const currentImage = images[currentIndex];
  const currentImageUrl = currentImage?.url;
  const currentImageName = currentImage?.name;
  const canNavigate = count > 1;
  const canAnnotate = Boolean(onImageChange);
  const canConfirmAnnotation = Boolean(onAnnotationConfirm);

  useEffect(() => {
    if (!canNavigate) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target) || isEditableKeyboardTarget(document.activeElement)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange(wrapIndex(currentIndex - 1, count));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange(wrapIndex(currentIndex + 1, count));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canNavigate, count, currentIndex, onIndexChange]);

  const loadImageToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImageUrl) return;

    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width <= 0 || height <= 0) return;

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      currentStrokeSnapshotRef.current = null;
      lastClickStrokeSnapshotRef.current = null;
      strokeStartPointRef.current = null;
      strokeMovedRef.current = false;
      setUndoStack([]);
      setIsDirty(false);
    };
    image.src = currentImageUrl;
  }, [currentImageUrl]);

  useEffect(() => {
    if (canAnnotate) loadImageToCanvas();
  }, [canAnnotate, loadImageToCanvas]);

  const getCanvasPoint = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const beginStroke = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (!canAnnotate) return;
    if (event.detail > 1) {
      event.preventDefault();
      return;
    }

    const canvas = canvasRef.current;
    const point = getCanvasPoint(event);
    if (!canvas || !point) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    currentStrokeSnapshotRef.current = snapshot;
    lastClickStrokeSnapshotRef.current = null;
    strokeStartPointRef.current = point;
    strokeMovedRef.current = false;
    setUndoStack((prev) => [...prev.slice(-9), snapshot]);
    isDrawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);

    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = DRAW_COLOR;
    ctx.lineWidth = BRUSH_SIZE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    setIsDirty(true);
  }, [canAnnotate, getCanvasPoint]);

  const continueStroke = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;

    const canvas = canvasRef.current;
    const point = getCanvasPoint(event);
    if (!canvas || !point) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const startPoint = strokeStartPointRef.current;
    if (startPoint) {
      const distance = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
      if (distance > CLICK_STROKE_MOVEMENT_THRESHOLD) strokeMovedRef.current = true;
    }

    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }, [getCanvasPoint]);

  const endStroke = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (isDrawingRef.current) {
      lastClickStrokeSnapshotRef.current = strokeMovedRef.current ? null : currentStrokeSnapshotRef.current;
    }

    isDrawingRef.current = false;
    currentStrokeSnapshotRef.current = null;
    strokeStartPointRef.current = null;
    strokeMovedRef.current = false;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }, []);

  const rollbackClickStroke = useCallback(() => {
    const snapshot = lastClickStrokeSnapshotRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!snapshot || !canvas || !ctx) return;

    ctx.putImageData(snapshot, 0, 0);
    lastClickStrokeSnapshotRef.current = null;
    setUndoStack((prev) => {
      const next = prev.at(-1) === snapshot ? prev.slice(0, -1) : prev;
      setIsDirty(next.length > 0);
      return next;
    });
  }, []);

  const handleCanvasDoubleClick = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    isDrawingRef.current = false;
    rollbackClickStroke();
  }, [rollbackClickStroke]);

  const undoStroke = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    setUndoStack((prev) => {
      const last = prev.at(-1);
      if (!last) return prev;
      ctx.putImageData(last, 0, 0);
      setIsDirty(true);
      return prev.slice(0, -1);
    });
  }, []);

  const commitAnnotation = useCallback(({
    closeAfter,
    includeNote,
  }: {
    closeAfter: boolean;
    includeNote: boolean;
  }) => {
    const closeIfNeeded = () => {
      if (closeAfter) ref.current?.close();
    };
    const confirmNote = (file: File | null) => {
      if (includeNote && onAnnotationConfirm) onAnnotationConfirm(currentIndex, file, note);
    };

    const canvas = canvasRef.current;
    if (!canvas || !currentImage || !onImageChange) {
      confirmNote(null);
      closeIfNeeded();
      return;
    }

    if (!isDirty) {
      confirmNote(null);
      closeIfNeeded();
      return;
    }

    setIsSaving(true);
    canvas.toBlob((blob) => {
      setIsSaving(false);
      if (!blob) {
        closeIfNeeded();
        return;
      }

      const fileName = currentImageName?.replace(/\.[^.]+$/, ".png") || "annotated-frame.png";
      const file = new File([blob], fileName, { type: "image/png" });
      if (includeNote && onAnnotationConfirm) {
        confirmNote(file);
      } else {
        onImageChange(currentIndex, file);
      }
      setUndoStack([]);
      setIsDirty(false);
      closeIfNeeded();
    }, "image/png");
  }, [currentImage, currentImageName, currentIndex, isDirty, note, onAnnotationConfirm, onImageChange]);

  const closeWithAnnotation = useCallback(() => {
    commitAnnotation({ closeAfter: true, includeNote: false });
  }, [commitAnnotation]);

  // Keep the dialog setup stable while still closing with the latest canvas/note state.
  useEffect(() => {
    closeWithAnnotationRef.current = closeWithAnnotation;
  }, [closeWithAnnotation]);

  const confirmAnnotation = useCallback(() => {
    commitAnnotation({ closeAfter: true, includeNote: true });
  }, [commitAnnotation]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();
    dialog.focus();

    const handleClose = () => onCloseRef.current();
    const handleCancel = (event: Event) => {
      if (!canAnnotate) return;
      event.preventDefault();
      closeWithAnnotationRef.current();
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [canAnnotate]);

  if (!currentImage) return null;

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label="Image preview"
      onClick={(e) => { if (e.target === ref.current) closeWithAnnotation(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        width: "100vw", height: "100vh", maxWidth: "100vw", maxHeight: "100vh",
        background: "rgba(0,0,0,0.75)", border: "none", padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "zoom-out",
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); closeWithAnnotation(); }}
        aria-label="Close preview"
        style={{
          position: "absolute", top: 16, right: 16,
          width: 36, height: 36, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)", border: "none",
          color: "#fff", fontSize: 20, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        &times;
      </button>

      {canNavigate && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(wrapIndex(currentIndex - 1, count));
          }}
          aria-label="Previous image"
          style={{
            position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
            width: 40, height: 40, borderRadius: "50%",
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", fontSize: 24, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ‹
        </button>
      )}

      {canAnnotate ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 10,
            maxWidth: "90vw",
            cursor: "default",
          }}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={currentImage.name || "Image preview"}
            onPointerDown={beginStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onDoubleClick={handleCanvasDoubleClick}
            style={{
              maxWidth: "90vw",
              maxHeight: "76vh",
              borderRadius: 8,
              objectFit: "contain",
              cursor: "crosshair",
              touchAction: "none",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(20,20,20,0.86)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Instruction for this frame"
              aria-label="Frame instruction"
              style={{
                flex: 1,
                minWidth: 0,
                height: 34,
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                outline: "none",
                padding: "0 10px",
                fontFamily: "var(--font)",
                fontSize: 14,
              }}
            />

            <button
              type="button"
              onClick={undoStroke}
              disabled={undoStack.length === 0}
              aria-label="Undo drawing"
              title="Undo"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "none",
                background: "transparent",
                color: "#fff",
                cursor: undoStack.length === 0 ? "default" : "pointer",
                opacity: undoStack.length === 0 ? 0.45 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14 4 9l5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h10a6 6 0 1 1 0 12h-2" />
              </svg>
            </button>

            <button
              type="button"
              onClick={confirmAnnotation}
              disabled={isSaving || !canConfirmAnnotation}
              aria-label="Apply frame instruction"
              title="Apply"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "none",
                background: "#fff",
                color: "#111",
                cursor: isSaving || !canConfirmAnnotation ? "default" : "pointer",
                opacity: isSaving || !canConfirmAnnotation ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <img
          src={currentImage.url}
          alt={currentImage.name || "Preview"}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "90vw", maxHeight: "90vh",
            borderRadius: 8, objectFit: "contain",
            cursor: "default",
          }}
        />
      )}

      {canNavigate && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(wrapIndex(currentIndex + 1, count));
          }}
          aria-label="Next image"
          style={{
            position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
            width: 40, height: 40, borderRadius: "50%",
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", fontSize: 24, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ›
        </button>
      )}

      {canNavigate && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "4px 10px",
            borderRadius: 9999,
            background: "rgba(0,0,0,0.45)",
            color: "#fff",
            fontSize: 12,
            fontFamily: "var(--font)",
          }}
        >
          {currentIndex + 1} / {count}
        </div>
      )}
    </dialog>
  );
}
