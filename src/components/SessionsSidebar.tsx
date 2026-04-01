"use client";

import { useEffect, useReducer, useCallback, type MouseEvent, type ReactNode } from "react";
import { StudioAccountCard, type StudioConnectionSummary } from "@/components/StudioStatus";

type Session = {
  id: string;
  title: string;
  updated_at: string;
};

interface SessionsSidebarProps {
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isLibraryActive?: boolean;
  onLibraryClick?: () => void;
  studioConnection?: StudioConnectionSummary | null;
}

interface SessionsState {
  sessions: Session[];
  loading: boolean;
}

type SessionsAction =
  | { type: "SET_SESSIONS"; sessions: Session[] }
  | { type: "SET_LOADING"; loading: boolean };

interface SidebarNavButtonProps {
  active: boolean;
  activeColor?: string;
  compact?: boolean;
  icon: ReactNode;
  inactiveColor: string;
  label: string;
  onClick: () => void;
}

function NewSessionIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function LibraryIcon({ size = 16, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function handleNavHover(event: MouseEvent<HTMLButtonElement>, active: boolean, hovered: boolean) {
  if (active) return;
  event.currentTarget.style.background = hovered ? "var(--bg-hover)" : "transparent";
}

function SidebarNavButton({
  active,
  activeColor,
  compact = false,
  icon,
  inactiveColor,
  label,
  onClick,
}: SidebarNavButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        ...(compact
          ? {
              width: 36,
              height: 36,
              justifyContent: "center",
            }
          : {
              gap: 10,
              padding: "8px 8px",
              width: "100%",
              textAlign: "left" as const,
              fontSize: 14,
            }),
        borderRadius: 8,
        color: active ? (activeColor ?? inactiveColor) : inactiveColor,
        cursor: "pointer",
        background: active ? "var(--bg-active)" : "transparent",
        border: "none",
        fontFamily: "var(--font)",
        transition: "background 0.12s",
      }}
      onMouseEnter={(event) => handleNavHover(event, active, true)}
      onMouseLeave={(event) => handleNavHover(event, active, false)}
    >
      {icon}
      {!compact && label}
    </button>
  );
}

function sessionsReducer(state: SessionsState, action: SessionsAction): SessionsState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions, loading: false };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    default:
      return state;
  }
}

export function SessionsSidebar({
  activeSessionId,
  onSessionSelect,
  onNewSession,
  isCollapsed,
  onToggleCollapse,
  isLibraryActive = false,
  onLibraryClick,
  studioConnection = null,
}: SessionsSidebarProps) {
  const [state, dispatch] = useReducer(sessionsReducer, {
    sessions: [],
    loading: true,
  });
  const isHomeActive = !activeSessionId && !isLibraryActive;

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) {
        dispatch({ type: "SET_LOADING", loading: false });
        return;
      }
      const sessions = (await response.json()) as Session[];
      dispatch({ type: "SET_SESSIONS", sessions: sessions || [] });
    } catch {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, 2000);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  if (isCollapsed) {
    return (
      <div
        style={{
          width: 52,
          background: "var(--bg-sidebar)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "16px 0",
          gap: 4,
          height: "100%",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onNewSession}
          aria-label="Home"
          style={{
            width: 32,
            height: 32,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 400,
            fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif",
            color: "var(--accent)",
            lineHeight: 1,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            borderRadius: 8,
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          ∑
        </button>

        <SidebarNavButton
          active={isHomeActive}
          compact
          icon={<NewSessionIcon size={18} />}
          inactiveColor="var(--icon-secondary)"
          label="New session"
          onClick={onNewSession}
        />

        {onLibraryClick && (
          <SidebarNavButton
            active={isLibraryActive}
            activeColor="var(--accent)"
            compact
            icon={<LibraryIcon size={17} />}
            inactiveColor="var(--icon-secondary)"
            label="Library"
            onClick={onLibraryClick}
          />
        )}

        <button
          onClick={onToggleCollapse}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--icon-secondary)",
            cursor: "pointer",
            border: "none",
            background: "transparent",
            transition: "background 0.12s",
          }}
          title="Expand sidebar"
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        <div style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        width: 260,
        background: "var(--bg-sidebar)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        padding: "16px 12px",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 16px" }}>
        <button
          onClick={onNewSession}
          aria-label="Home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "none",
            border: "none",
            padding: "4px 6px",
            cursor: "pointer",
            borderRadius: 8,
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ fontSize: 22, fontWeight: 400, fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif", color: "var(--accent)", lineHeight: 1 }}>∑</span>
          <span style={{ fontSize: 19, fontWeight: 400, fontFamily: "var(--font-display)", color: "var(--text-primary)", lineHeight: 1 }}>Manimate</span>
        </button>
        <button
          onClick={onToggleCollapse}
          style={{
            marginLeft: "auto",
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--icon-tertiary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Collapse sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </div>

      <SidebarNavButton
        active={isHomeActive}
        activeColor="var(--text-primary)"
        icon={<NewSessionIcon />}
        inactiveColor="var(--text-secondary)"
        label="New session"
        onClick={onNewSession}
      />

      {onLibraryClick && (
        <SidebarNavButton
          active={isLibraryActive}
          activeColor="var(--text-primary)"
          icon={<LibraryIcon />}
          inactiveColor="var(--text-secondary)"
          label="Library"
          onClick={onLibraryClick}
        />
      )}

      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-tertiary)",
          padding: "16px 8px 6px",
        }}
      >
        All sessions
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {state.loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "2px solid var(--border-input)",
                borderTopColor: "var(--accent)",
                animation: "spin 1s linear infinite",
              }}
            />
          </div>
        ) : state.sessions.length === 0 ? (
          <div style={{ padding: "16px 8px", textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
            No sessions yet
          </div>
        ) : (
          state.sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSessionSelect(session.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 8px",
                borderRadius: 8,
                cursor: "pointer",
                width: "100%",
                border: "none",
                background: activeSessionId === session.id ? "var(--bg-active)" : "transparent",
                textAlign: "left",
                fontFamily: "var(--font)",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => {
                if (activeSessionId !== session.id) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (activeSessionId !== session.id) e.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {session.title}
              </div>
            </button>
          ))
        )}
      </div>

      <StudioAccountCard connection={studioConnection} />

    </div>
  );
}
