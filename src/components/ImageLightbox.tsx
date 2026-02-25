"use client";

import { useEffect, useRef } from "react";

interface LightboxImage {
  url: string;
  name?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (nextIndex: number) => void;
  onClose: () => void;
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export default function ImageLightbox({ images, index, onIndexChange, onClose }: ImageLightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const count = images.length;
  const currentIndex = wrapIndex(index, count);
  const currentImage = images[currentIndex];
  const canNavigate = count > 1;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();
    dialog.focus();

    const handleClose = () => onCloseRef.current();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  useEffect(() => {
    if (!canNavigate) return;

    const handleKeyDown = (event: KeyboardEvent) => {
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

  if (!currentImage) return null;

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label="Image preview"
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
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
        onClick={(e) => { e.stopPropagation(); ref.current?.close(); }}
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
