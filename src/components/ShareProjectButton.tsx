"use client";

import { useEffect, useRef, useState } from "react";

type ShareState = "idle" | "loading" | "copied" | "error";

interface ShareProjectButtonProps {
  sessionId: string | null | undefined;
}

type ShareApiPayload = {
  share_url: string;
};

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

function scheduleStateReset(
  resetTimerRef: { current: ReturnType<typeof setTimeout> | null },
  setState: (value: ShareState) => void,
) {
  if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  resetTimerRef.current = setTimeout(() => {
    setState("idle");
  }, 2000);
}

async function requestShareUrl(sessionId: string): Promise<string> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/share`, {
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || typeof payload.share_url !== "string") {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Failed to create share link",
    );
  }

  return (payload as ShareApiPayload).share_url;
}

export default function ShareProjectButton({ sessionId }: ShareProjectButtonProps) {
  const [state, setState] = useState<ShareState>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const disabled = !sessionId || state === "loading";
  const isEmphasized = isOpen || state === "copied";
  const label = state === "loading"
    ? "Creating..."
    : state === "copied"
      ? "Copied"
      : "Share";

  async function handleCopy(url: string) {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    try {
      await copyText(url);
      setState("copied");
      scheduleStateReset(resetTimerRef, setState);
      setErrorMessage(null);
    } catch {
      setState("error");
      setErrorMessage("Copy failed. Copy the link manually.");
    }
  }

  async function handleClick() {
    if (!sessionId || state === "loading") return;

    setIsOpen(true);
    setErrorMessage(null);

    if (shareUrl) {
      await handleCopy(shareUrl);
      return;
    }

    setState("loading");

    try {
      const nextShareUrl = await requestShareUrl(sessionId);
      setShareUrl(nextShareUrl);
      await handleCopy(nextShareUrl);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to create share link");
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        type="button"
        data-testid="share-project-trigger"
        onClick={() => { void handleClick(); }}
        disabled={disabled}
        title={errorMessage || (sessionId ? "Create a shareable manimate.ai link and copy it" : "Finish a render to create a share link")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          minHeight: 29,
          padding: "4px 12px",
          borderRadius: 999,
          border: isEmphasized ? "1px solid rgba(43,181,160,0.26)" : "1px solid var(--border-main)",
          background: isEmphasized
            ? "linear-gradient(180deg, rgba(43,181,160,0.12) 0%, rgba(43,181,160,0.07) 100%)"
            : "var(--bg-white)",
          color: state === "error" ? "#b42318" : "var(--text-primary)",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "var(--font)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: isEmphasized ? "0 6px 18px rgba(43,181,160,0.10)" : "none",
          transition: "all 0.16s ease",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke={state === "error" ? "#b42318" : isEmphasized ? "var(--accent)" : "currentColor"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M20 16.5a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 16.5" />
        </svg>
        <span style={{ letterSpacing: state === "copied" ? "0.01em" : undefined }}>{label}</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            width: "min(340px, calc(100vw - 32px))",
            padding: 14,
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,0.07)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,250,250,0.98) 100%)",
            boxShadow: "0 22px 44px rgba(15, 23, 42, 0.14)",
            zIndex: 40,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: 12,
                borderRadius: 14,
                background: "linear-gradient(135deg, rgba(43,181,160,0.10) 0%, rgba(43,181,160,0.04) 55%, rgba(255,255,255,0.9) 100%)",
                border: "1px solid rgba(43,181,160,0.14)",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.86)",
                  color: "var(--accent)",
                  boxShadow: "inset 0 0 0 1px rgba(43,181,160,0.12)",
                  fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif",
                  fontSize: 20,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ∑
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 17,
                    lineHeight: 1.1,
                    fontFamily: "var(--font-display)",
                    fontWeight: 400,
                    color: "var(--text-primary)",
                  }}
                >
                  Share With Manimate
                </div>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "var(--text-secondary)",
                  }}
                >
                  This creates the canonical hosted share link and copies it to your clipboard.
                </div>
              </div>
            </div>

            {shareUrl && (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    Share Link
                  </span>
                  <input
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "var(--bg-main)",
                      color: "var(--text-primary)",
                      fontSize: 12,
                      fontFamily: "'Monaco', 'Menlo', monospace",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                    }}
                  />
                </label>
                <button
                  type="button"
                  data-testid="share-project-copy"
                  onClick={() => { if (shareUrl) void handleCopy(shareUrl); }}
                  style={{
                    width: "100%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(43,181,160,0.16)",
                    background: state === "copied" ? "var(--accent-hover)" : "var(--accent)",
                    color: "#ffffff",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    cursor: "pointer",
                    boxShadow: "0 12px 24px rgba(43,181,160,0.18)",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>{state === "copied" ? "Link Copied" : "Copy Link"}</span>
                </button>
              </>
            )}

            {state === "loading" && (
              <div
                style={{
                  padding: "2px 2px 0",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                Creating share link...
              </div>
            )}

            {errorMessage && (
              <div
                style={{
                  padding: "10px 11px",
                  borderRadius: 10,
                  border: "1px solid rgba(180,35,24,0.10)",
                  background: "rgba(180,35,24,0.04)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "#b42318",
                }}
              >
                {errorMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
