"use client";

import { useEffect, useState, useCallback } from "react";

type LibrarySession = {
  id: string;
  title: string;
  status: string;
  has_video: boolean;
  last_video_url: string | null;
  aspect_ratio: string | null;
  updated_at: string;
};

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
  onClick,
}: {
  session: LibrarySession;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const isRunning = session.status === "running" || session.status === "queued";
  const aspectPadding = ASPECT_PADDING_BY_RATIO[session.aspect_ratio ?? ""] ?? "56.25%";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        fontFamily: "var(--font)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,0.08)" : "0 1px 4px rgba(0,0,0,0.04)",
        borderColor: hovered ? "var(--border-focus, var(--accent))" : "var(--border-main)",
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: "relative", width: "100%", paddingBottom: aspectPadding, background: "var(--bg-muted, #f5f4f2)", flexShrink: 0 }}>
        {session.has_video && !thumbnailFailed ? (
          <img
            src={`/api/thumbnail?session_id=${encodeURIComponent(session.id)}&_v=${encodeURIComponent(session.updated_at)}`}
            alt={session.title}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
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
        {/* Status badge */}
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

      {/* Info */}
      <div style={{ padding: "10px 12px 12px" }}>
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
          {formatDate(session.updated_at)}
        </div>
      </div>
    </button>
  );
}

export function LibraryView({ onSessionSelect }: { onSessionSelect: (id: string) => void }) {
  const [sessions, setSessions] = useState<LibrarySession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as LibrarySession[];
      setSessions((data || []).filter((session) => session.has_video));
    } catch {
      // Network error — keep existing data, don't blank the grid
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, 5000);
    return () => clearInterval(timer);
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
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "var(--text-primary)",
          fontFamily: "var(--font-display)",
          margin: "0 0 24px",
        }}
      >
        Library
      </h1>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 64 }}>
          <Spinner />
        </div>
      ) : sessions.length === 0 ? (
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
      ) : (
        <div
          style={{
            columns: "220px",
            columnGap: 14,
          }}
        >
          {sessions.map((session) => (
            <div key={`${session.id}:${session.updated_at}`} style={{ breakInside: "avoid", marginBottom: 14 }}>
              <VideoCard
                session={session}
                onClick={() => onSessionSelect(session.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
