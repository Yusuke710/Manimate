"use client";

import Image from "next/image";
import { useDeferredValue, useEffect, useState, useCallback, useMemo, useRef, type FormEvent, type MouseEvent } from "react";

const LIBRARY_REFRESH_INTERVAL_MS = 60_000;

type LibrarySession = {
  id: string;
  session_number: number;
  title: string;
  status: string;
  has_video: boolean;
  last_video_url: string | null;
  aspect_ratio: string | null;
  created_at: string;
  updated_at: string;
};

type FeedbackSubmissionResponse = {
  ok: boolean;
  session_id: string;
  session_number: number;
  submitted_at: string;
};

function getFeedbackSubmissionError(
  value: FeedbackSubmissionResponse | { error?: string } | null,
): string | null {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return null;
}

const ASPECT_PADDING_BY_RATIO: Record<string, string> = {
  "9:16": "177.78%",
  "1:1": "100%",
  "4:3": "75%",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 7 * 86400000) {
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function Spinner({ size = 28, borderWidth = 2.5 }: { size?: number; borderWidth?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${borderWidth}px solid var(--border-input)`,
        borderTopColor: "var(--accent)",
        animation: "spin 1s linear infinite",
      }}
    />
  );
}

function VideoCard({
  session,
  href,
  onClick,
  onDoubleClick,
}: {
  session: LibrarySession;
  href: string;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const clickTimerRef = useRef<number | null>(null);
  const isRunning = session.status === "running" || session.status === "queued";
  const aspectPadding = ASPECT_PADDING_BY_RATIO[session.aspect_ratio ?? ""] ?? "56.25%";

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current === null) return;
    window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }, []);

  useEffect(() => clearClickTimer, [clearClickTimer]);

  const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    clearClickTimer();
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onClick();
    }, 220);
  }, [clearClickTimer, onClick]);

  const handleDoubleClick = useCallback(() => {
    clearClickTimer();
    onDoubleClick();
  }, [clearClickTimer, onDoubleClick]);

  return (
    <a
      href={href}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Click to open. Double-click to open in a new tab."
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        background: hovered ? "var(--bg-hover)" : "var(--bg-card, var(--bg-white))",
        border: "1px solid var(--border-main)",
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        textDecoration: "none",
        fontFamily: "var(--font)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,0.08)" : "0 1px 4px rgba(0,0,0,0.04)",
        borderColor: hovered ? "var(--border-focus, var(--accent))" : "var(--border-main)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: aspectPadding,
          background: "var(--bg-muted, #f5f4f2)",
          flexShrink: 0,
        }}
      >
        {session.has_video && !thumbnailFailed ? (
          <Image
            src={`/api/thumbnail?session_id=${encodeURIComponent(session.id)}&_v=${encodeURIComponent(session.updated_at)}`}
            alt={session.title}
            fill
            unoptimized
            sizes="220px"
            style={{
              objectFit: "cover",
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
              setThumbnailFailed(true);
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isRunning ? (
              <Spinner />
            ) : (
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-tertiary)"
                strokeWidth={1.5}
              >
                <rect x="2" y="2" width="20" height="20" rx="2.5" />
                <path d="M10 8l6 4-6 4V8z" />
              </svg>
            )}
          </div>
        )}
        {isRunning && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "var(--accent)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 20,
              letterSpacing: 0.3,
            }}
          >
            {session.status === "queued" ? "Queued" : "Running"}
          </div>
        )}
      </div>

      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, marginBottom: 4 }}>
          Session #{session.session_number}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            lineHeight: 1.4,
            marginBottom: 4,
          }}
        >
          {session.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          {formatDate(session.created_at)}
        </div>
      </div>
    </a>
  );
}

function FeedbackPanel({
  initialSelectedSessionId,
  sessions,
  onSessionSelect,
}: {
  initialSelectedSessionId?: string | null;
  sessions: LibrarySession[];
  onSessionSelect: (id: string) => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState(initialSelectedSessionId ?? "");
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<FeedbackSubmissionResponse | null>(null);
  const lastAppliedInitialSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId("");
      lastAppliedInitialSessionIdRef.current = null;
      return;
    }
    const hasInitialSelection =
      initialSelectedSessionId &&
      sessions.some((session) => session.id === initialSelectedSessionId);

    if (
      hasInitialSelection &&
      lastAppliedInitialSessionIdRef.current !== initialSelectedSessionId
    ) {
      lastAppliedInitialSessionIdRef.current = initialSelectedSessionId;
      setSelectedSessionId(initialSelectedSessionId);
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(hasInitialSelection ? initialSelectedSessionId : sessions[0].id);
    }
  }, [initialSelectedSessionId, selectedSessionId, sessions]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedSession) return;

      const trimmed = feedback.trim();
      if (!trimmed) {
        setError("Feedback cannot be empty.");
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(selectedSession.id)}/feedback`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback: trimmed }),
          }
        );

        const data = (await response.json().catch(() => null)) as
          | FeedbackSubmissionResponse
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(getFeedbackSubmissionError(data) ?? "Failed to save feedback.");
        }

        setReceipt(data as FeedbackSubmissionResponse);
        setFeedback("");
      } catch (submitError) {
        setError(
          submitError instanceof Error ? submitError.message : "Failed to save feedback."
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [feedback, selectedSession]
  );

  if (sessions.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--text-tertiary)",
          paddingTop: 80,
          textAlign: "center",
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
          <rect x="3" y="4" width="18" height="14" rx="2.5" />
          <path d="M7 8h10M7 12h6" />
        </svg>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>
          No finished sessions yet
        </div>
        <div style={{ fontSize: 13, maxWidth: 420 }}>
          Create an animation first, then attach feedback to the session it belongs to.
        </div>
      </div>
    );
  }

  if (receipt) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 0 0",
        }}
      >
        <div
          style={{
            width: "min(560px, 100%)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,248,244,0.98))",
            border: "1px solid var(--border-main)",
            borderRadius: 20,
            padding: "32px 28px",
            boxShadow: "0 16px 40px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 14,
          }}
        >
          <Image
            src="/icon.svg"
            alt="Manimate logo"
            width={56}
            height={56}
            style={{ width: 56, height: 56, borderRadius: 14 }}
          />
          <div style={{ fontSize: 24, fontWeight: 600, color: "var(--text-primary)" }}>
            Thank you for your feedback
          </div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 420, lineHeight: 1.6 }}>
            Your note was saved with Session #{receipt.session_number} so Manimate can track this
            session later for product and agent improvements.
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 10%, white)",
              border: "1px solid color-mix(in srgb, var(--accent) 25%, white)",
              borderRadius: 999,
              padding: "6px 10px",
            }}
          >
            Session #{receipt.session_number}
          </div>
          <button
            onClick={() => setReceipt(null)}
            style={{
              marginTop: 6,
              border: "1px solid var(--border-main)",
              background: "var(--bg-white)",
              color: "var(--text-primary)",
              borderRadius: 10,
              padding: "10px 14px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font)",
            }}
          >
            Send more feedback
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        width: "min(720px, 100%)",
        paddingTop: 12,
      }}
    >
      <div
        style={{
          background: "var(--bg-card, var(--bg-white))",
          border: "1px solid var(--border-main)",
          borderRadius: 18,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
            Session
          </span>
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <select
              value={selectedSession?.id ?? ""}
              onChange={(event) => setSelectedSessionId(event.target.value)}
              style={{
                appearance: "none",
                flex: 1,
                border: "1px solid var(--border-main)",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 14,
                color: "var(--text-primary)",
                background: "var(--bg-white)",
                fontFamily: "var(--font)",
                minWidth: 0,
              }}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {`Session #${session.session_number} · ${session.title}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (selectedSession) onSessionSelect(selectedSession.id);
              }}
              disabled={!selectedSession}
              aria-label={selectedSession ? `Open Session #${selectedSession.session_number}` : "Open session"}
              title={selectedSession ? `Open Session #${selectedSession.session_number}` : "Open session"}
              style={{
                appearance: "none",
                width: 48,
                height: 48,
                borderRadius: 12,
                border: selectedSession ? "1px solid var(--accent)" : "1px solid var(--border-main)",
                background: selectedSession ? "var(--accent)" : "var(--bg-white)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: selectedSession ? "#fff" : "var(--text-tertiary)",
                cursor: selectedSession ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
            What should we improve?
          </span>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={
              selectedSession
                ? `Tell us what happened in Session #${selectedSession.session_number}...`
                : "Tell us what happened..."
            }
            rows={8}
            style={{
              resize: "vertical",
              minHeight: 180,
              border: "1px solid var(--border-main)",
              borderRadius: 14,
              padding: "14px 16px",
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--text-primary)",
              background: "var(--bg-white)",
              fontFamily: "var(--font)",
            }}
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#c33", minHeight: 18 }}>
            {error ?? ""}
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !selectedSession || !feedback.trim()}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "11px 16px",
              background:
                isSubmitting || !selectedSession || !feedback.trim()
                  ? "var(--border-main)"
                  : "var(--accent)",
              color: "#fff",
              cursor:
                isSubmitting || !selectedSession || !feedback.trim() ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font)",
              minWidth: 132,
            }}
          >
            {isSubmitting ? "Saving..." : "Send feedback"}
          </button>
        </div>
      </div>
    </form>
  );
}

export function LibraryView({
  initialSelectedSessionId,
  mode = "videos",
  onSessionSelect,
}: {
  initialSelectedSessionId?: string | null;
  mode?: "videos" | "feedback";
  onSessionSelect: (id: string) => void;
}) {
  const [allSessions, setAllSessions] = useState<LibrarySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const requestInFlightRef = useRef(false);

  const fetchSessions = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      const res = await fetch(
        mode === "videos" ? "/api/sessions?full=1" : "/api/sessions",
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as LibrarySession[];
      setAllSessions(data || []);
    } catch {
      // Keep the existing library state if refresh fails.
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }, [mode]);

  const videoSessions = useMemo(
    () => allSessions.filter((session) => session.has_video),
    [allSessions]
  );

  // Search runs server-side (title + plan + script) so artifact content is
  // never shipped to the browser; see /api/sessions?full=1&q=…
  const [searchResults, setSearchResults] = useState<LibrarySession[] | null>(null);
  const trimmedDeferredQuery = deferredSearchQuery.trim();
  useEffect(() => {
    if (!trimmedDeferredQuery) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sessions?full=1&q=${encodeURIComponent(trimmedDeferredQuery)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as LibrarySession[];
        if (!cancelled) setSearchResults(data || []);
      } catch {
        // Keep the previous results if the search request fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmedDeferredQuery]);

  const filteredVideoSessions = searchResults ?? videoSessions;
  const trimmedSearchQuery = searchQuery.trim();

  const handleSessionOpenInNewTab = useCallback((sessionId: string) => {
    window.open(`/?session=${encodeURIComponent(sessionId)}`, "_blank", "noopener,noreferrer");
  }, []);

  const getSessionHref = useCallback((sessionId: string) => (
    `/?session=${encodeURIComponent(sessionId)}`
  ), []);

  useEffect(() => {
    fetchSessions();
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchSessions();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchSessions();
      }
    };
    const timer = window.setInterval(refreshIfVisible, LIBRARY_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchSessions]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "32px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--text-primary)",
                fontFamily: "var(--font-display)",
                margin: 0,
              }}
            >
              {mode === "feedback" ? "Feedback" : "Library"}
            </h1>
            {mode !== "feedback" && (
              <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                Review finished videos from your local sessions.
              </div>
            )}
          </div>
          {mode !== "feedback" && (
            <label
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                width: "min(100%, 360px)",
                flex: "0 1 360px",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  display: "flex",
                  color: "var(--icon-tertiary)",
                  pointerEvents: "none",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                </svg>
              </span>
              <input
                type="search"
                aria-label="Search library videos"
                placeholder="Search videos, plans, code"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                style={{
                  width: "100%",
                  height: 38,
                  border: "1px solid var(--border-main)",
                  borderRadius: 10,
                  background: "var(--bg-white)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font)",
                  fontSize: 14,
                  padding: "0 36px 0 36px",
                  outline: "none",
                }}
                onFocus={(event) => {
                  event.currentTarget.style.borderColor = "var(--border-focus, var(--accent))";
                }}
                onBlur={(event) => {
                  event.currentTarget.style.borderColor = "var(--border-main)";
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear library search"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: 7,
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--icon-tertiary)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              )}
            </label>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 64 }}>
          <Spinner />
        </div>
      ) : mode === "feedback" ? (
        <FeedbackPanel
          initialSelectedSessionId={initialSelectedSessionId}
          sessions={allSessions}
          onSessionSelect={onSessionSelect}
        />
      ) : videoSessions.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "var(--text-tertiary)",
            paddingTop: 80,
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
            <rect x="2" y="2" width="20" height="20" rx="2.5" />
            <path d="M10 8l6 4-6 4V8z" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 500 }}>No videos yet</div>
          <div style={{ fontSize: 13 }}>Generate an animation to see it here</div>
        </div>
      ) : filteredVideoSessions.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "var(--text-tertiary)",
            paddingTop: 80,
            textAlign: "center",
          }}
        >
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5L21 21" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 500 }}>No matches</div>
          <div style={{ fontSize: 13 }}>
            {trimmedSearchQuery ? `No videos match "${trimmedSearchQuery}".` : "No videos match this search."}
          </div>
        </div>
      ) : (
        <div
          style={{
            columns: "220px",
            columnGap: 14,
          }}
        >
          {filteredVideoSessions.map((session) => (
            <div key={`${session.id}:${session.updated_at}`} style={{ breakInside: "avoid", marginBottom: 14 }}>
              <VideoCard
                session={session}
                href={getSessionHref(session.id)}
                onClick={() => onSessionSelect(session.id)}
                onDoubleClick={() => handleSessionOpenInNewTab(session.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
