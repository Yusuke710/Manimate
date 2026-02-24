"use client";

import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";

const MAX_IMAGES = 12;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface ImagePreview {
  file: File;
  url: string;
}

interface ChatInputProps {
  onSend: (prompt: string, images?: File[]) => void;
  onStop?: () => void;
  onPrewarm?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  extraLeft?: ReactNode;
  compact?: boolean;
  /** localStorage key for persisting draft text across refreshes. Omit to disable. */
  draftKey?: string;
}

export default function ChatInput({ onSend, onStop, onPrewarm, isLoading = false, disabled = false, placeholder, extraLeft, compact = false, draftKey }: ChatInputProps) {
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasPrewarmedRef = useRef(false);
  const scrollToBottomRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false); // set true after restore to skip one debounced save

  // Restore draft from localStorage on mount (client-only to avoid hydration mismatch)
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) { setPrompt(saved); restoredRef.current = true; }
    } catch { /* private mode / quota */ }
  }, [draftKey]);

  // Draft persistence: debounce save to localStorage, flush on pagehide
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  useEffect(() => {
    if (!draftKey) return;

    const saveDraft = () => {
      try {
        const val = promptRef.current;
        if (val) localStorage.setItem(draftKey, val);
        else localStorage.removeItem(draftKey);
      } catch { /* quota / private mode */ }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveDraft();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", saveDraft);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", saveDraft);
      saveDraft(); // flush on unmount (e.g. session switch)
    };
  }, [draftKey]);

  // Debounced save on prompt change
  useEffect(() => {
    if (!draftKey) return;
    // Skip the initial mount (value already came from localStorage)
    if (restoredRef.current) { restoredRef.current = false; return; }

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      try {
        if (prompt) localStorage.setItem(draftKey, prompt);
        else localStorage.removeItem(draftKey);
      } catch { /* quota / private mode */ }
    }, 500);

    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [prompt, draftKey]);

  // Trigger prewarm once per component mount
  const triggerPrewarm = useCallback(() => {
    if (hasPrewarmedRef.current || !onPrewarm) return;
    hasPrewarmedRef.current = true;
    onPrewarm();
  }, [onPrewarm]);

  const canSend = (prompt.trim().length > 0 || images.length > 0) && !disabled && !isLoading;
  const dense = images.length > 6;
  const thumbSize = dense ? 44 : 64;
  const thumbGap = dense ? 4 : 8;

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addImages = useCallback((files: File[]) => {
    const validFiles = files.filter((f) => {
      if (!ALLOWED_TYPES.includes(f.type)) return false;
      if (f.size > MAX_SIZE_BYTES) return false;
      return true;
    });

    if (validFiles.length > 0) triggerPrewarm();

    setImages((prev) => {
      const remaining = MAX_IMAGES - prev.length;
      const toAdd = validFiles.slice(0, remaining);
      const newPreviews = toAdd.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      return [...prev, ...newPreviews];
    });
  }, [triggerPrewarm]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const imageFiles = images.length > 0 ? images.map((img) => img.file) : undefined;
    onSend(prompt.trim(), imageFiles);
    setPrompt("");
    setImages([]);
    // Clear draft immediately on send — update ref so unmount flush won't re-save
    promptRef.current = "";
    if (draftKey) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      try { localStorage.removeItem(draftKey); } catch { /* noop */ }
    }
  }, [canSend, prompt, images, onSend, draftKey]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea based on content
  // In compact mode with images, keep textarea at 1 line to prevent layout shift
  const maxTextareaHeight = compact ? (images.length > 0 ? 24 : 80) : 200;
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxTextareaHeight)}px`;
      // Scroll to bottom after external text insertion
      if (scrollToBottomRef.current) {
        scrollToBottomRef.current = false;
        textarea.scrollTop = textarea.scrollHeight;
        textarea.focus();
      }
    }
  }, [prompt, maxTextareaHeight]);

  // Listen for text insertion events from external sources
  useEffect(() => {
    const handleInsertText = (e: CustomEvent<string>) => {
      setPrompt(prev => {
        // Auto-prepend newline if current line has content
        const needsNewline = prev.length > 0 && !prev.endsWith("\n");
        return (needsNewline ? prev + "\n" : prev) + e.detail;
      });
      scrollToBottomRef.current = true;
    };

    window.addEventListener("chat-insert-text", handleInsertText as EventListener);
    return () => window.removeEventListener("chat-insert-text", handleInsertText as EventListener);
  }, []);

  // Listen for image addition events from external sources (e.g. video frame capture)
  useEffect(() => {
    const handleAddImage = (e: CustomEvent<File>) => {
      addImages([e.detail]);
    };

    window.addEventListener("chat-add-image", handleAddImage as EventListener);
    return () => window.removeEventListener("chat-add-image", handleAddImage as EventListener);
  }, [addImages]);

  // Paste support for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addImages(imageFiles);
      }
    },
    [addImages]
  );

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) {
        addImages(files);
      }
    },
    [addImages]
  );

  return (
    <div style={{ padding: compact ? "0 10px 8px" : "0 16px 16px" }}>
      {/* Image thumbnail strip — shrinks when many images */}
      {images.length > 0 && (
        <div style={{
          display: "flex", flexWrap: compact ? "nowrap" : "wrap", gap: thumbGap,
          marginBottom: 8, alignItems: "center",
          overflowX: compact ? "auto" : undefined,
        }}>
          {images.map((img, index) => (
            <div key={img.url} style={{ position: "relative", flexShrink: 0 }}>
              <img
                src={img.url}
                alt={img.file.name}
                onClick={() => setLightboxUrl(img.url)}
                style={{
                  height: thumbSize, width: thumbSize,
                  borderRadius: 6, objectFit: "cover",
                  border: "1px solid var(--border-main)",
                  cursor: "zoom-in",
                }}
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                style={{
                  position: "absolute", top: -5, right: -5,
                  width: 18, height: 18,
                  borderRadius: "50%",
                  background: "var(--text-primary)", color: "#fff",
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10,
                }}
                aria-label={`Remove ${img.file.name}`}
              >
                x
              </button>
            </div>
          ))}
          {images.length > 4 && (
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: 2 }}>
              {images.length}/{MAX_IMAGES}
            </span>
          )}
        </div>
      )}

      {/* Pill-shaped input wrapper */}
      <div
        style={{
          background: "var(--bg-white)",
          border: `1px solid ${dragOver ? "var(--accent)" : "rgba(0,0,0,0.15)"}`,
          borderRadius: compact ? 18 : 22,
          padding: compact ? "8px 12px" : "12px 16px",
          boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <textarea
            ref={textareaRef}
            data-testid="chat-input"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (e.target.value.length > 0) triggerPrewarm();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder || "Describe the animation you want to create..."}
            disabled={disabled}
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none", outline: "none",
              color: "var(--text-primary)",
              fontFamily: "var(--font)",
              fontSize: 16,
              lineHeight: 1.5,
              resize: "none",
              minHeight: 24,
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: compact ? 4 : 8, gap: 4 }}>
          {/* Attach button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0) addImages(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || images.length >= MAX_IMAGES}
            style={{
              width: 32, height: 32,
              borderRadius: "50%",
              border: "1px solid var(--border-main)",
              background: "transparent",
              color: "var(--icon-tertiary)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14,
              transition: "all 0.12s",
              opacity: disabled || images.length >= MAX_IMAGES ? 0.5 : 1,
            }}
            title="Attach images"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
            </svg>
          </button>

          {extraLeft}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            {/* Stop or Send button */}
            {isLoading ? (
              <button
                type="button"
                data-testid="stop-button"
                onClick={onStop}
                style={{
                  width: 36, height: 36,
                  borderRadius: 9999,
                  border: "none",
                  background: "var(--red)",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14,
                }}
                title="Stop"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                data-testid="send-button"
                onClick={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                disabled={!canSend}
                style={{
                  width: 36, height: 36,
                  borderRadius: 9999,
                  border: "none",
                  background: canSend ? "var(--accent)" : "var(--bg-card)",
                  color: canSend ? "var(--text-primary)" : "var(--text-tertiary)",
                  cursor: canSend ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16,
                  transition: "all 0.12s",
                }}
                title="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {dragOver && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--accent-muted)",
          borderRadius: 22,
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--accent)" }}>Drop images here</span>
        </div>
      )}

      {/* Image lightbox */}
      {lightboxUrl && (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
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
      <img
        src={url}
        alt="Preview"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw", maxHeight: "90vh",
          borderRadius: 8, objectFit: "contain",
          cursor: "default",
        }}
      />
    </dialog>
  );
}
