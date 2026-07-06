"use client";

import { useEffect, useCallback, useRef, useState, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatInput from "@/components/ChatInput";
import { ChatPanel, type PendingWelcomePayload } from "@/components/ChatPanel";
import {
  AspectRatioSelector,
  ModelSelector,
  VoiceSelector,
  usePreferredModel,
  usePreferredVoice,
} from "@/components/ComposerControls";
import { CloudAuthGate } from "@/components/CloudAuthGate";
import { SessionsSidebar } from "@/components/SessionsSidebar";
import { LibraryView } from "@/components/LibraryView";
import { StudioPlanPill } from "@/components/StudioStatus";
import { useIsMobile, usePreferredAspectRatio } from "@/lib/hooks";
import { DEFAULT_MODEL, type AspectRatio } from "@/lib/models";
import { DEFAULT_VOICE_ID } from "@/lib/voices";
import { parseUrlLaunchIntent } from "@/lib/url-launch-intent";
import type { CloudAuthStatus } from "@/lib/studio-cloud-auth";
import { useStudioCloudAuth } from "@/lib/useStudioCloudAuth";

function HomeContent({ initialCloudAuthStatus }: { initialCloudAuthStatus: CloudAuthStatus }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = usePreferredAspectRatio();
  const {
    cloudAuthStatus,
    cloudAuthLoading,
    reconnectCloudAuth,
  } = useStudioCloudAuth(initialCloudAuthStatus);
  const searchParamsString = searchParams.toString();

  const activeSessionId = searchParams.get("session");
  const activeView = searchParams.get("view");
  const feedbackSessionId = searchParams.get("feedback_session");
  const shareToken = searchParams.get("share");
  const isLibraryActive = !activeSessionId && activeView === "library";
  const isFeedbackActive = !activeSessionId && activeView === "feedback";
  const isSharedImportActive = !activeSessionId && !isLibraryActive && !isFeedbackActive && Boolean(shareToken);
  const launchIntent = useMemo(() => {
    if (activeSessionId) return null;
    return parseUrlLaunchIntent(searchParamsString);
  }, [activeSessionId, searchParamsString]);
  useEffect(() => {
    if (isMobile) return;
    const timer = window.setTimeout(() => {
      setSidebarCollapsed(Boolean(activeSessionId));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, isMobile]);

  // Optimistic session creation: keyed by session ID, stores Promise<boolean>
  const sessionCreationRef = useRef<{ id: string; ready: Promise<boolean> } | null>(null);
  const [pendingSessionReady, setPendingSessionReady] = useState<{ id: string; ready: Promise<boolean> } | null>(null);
  const pendingWelcomePayloadRef = useRef<Map<string, PendingWelcomePayload>>(new Map());
  const appliedLaunchAspectRef = useRef<string | null>(null);
  const consumedLaunchAutoSendRef = useRef<string | null>(null);

  const handleNewSession = useCallback(() => { router.push("/"); }, [router]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    router.push(`/?session=${sessionId}`);
  }, [router]);

  const handleLibraryClick = useCallback(() => {
    router.push("/?view=library");
  }, [router]);

  const handleFeedbackClick = useCallback(() => {
    const nextUrl = activeSessionId
      ? `/?view=feedback&feedback_session=${encodeURIComponent(activeSessionId)}`
      : "/?view=feedback";
    router.push(nextUrl);
  }, [activeSessionId, router]);

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen(prev => !prev);
    } else {
      setSidebarCollapsed(prev => !prev);
    }
  }, [isMobile]);

  // Prewarm sandbox when user starts typing (guard in ChatInput prevents duplicates)
  const handlePrewarm = useCallback(() => {
    fetch("/api/sandbox/prewarm", { method: "POST" }).catch(() => {});
  }, []);

  const hasPendingWelcomePayload = useCallback((sessionId: string) => {
    return pendingWelcomePayloadRef.current.has(sessionId);
  }, []);

  const consumeWelcomePayload = useCallback((sessionId: string) => {
    const payload = pendingWelcomePayloadRef.current.get(sessionId);
    if (!payload) return null;
    pendingWelcomePayloadRef.current.delete(sessionId);
    return payload;
  }, []);

  const handleWelcomeSend = useCallback((prompt: string, images?: File[], model?: string, voice?: string, ratioOverride?: AspectRatio) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && (!images || images.length === 0)) return;
    if (sessionCreationRef.current) return; // prevent double-submit

    const id = crypto.randomUUID();
    pendingWelcomePayloadRef.current.set(id, {
      prompt: trimmedPrompt,
      images: images && images.length > 0 ? [...images] : undefined,
      model: model ?? DEFAULT_MODEL,
      voiceId: voice ?? DEFAULT_VOICE_ID,
      aspectRatio: ratioOverride ?? aspectRatio,
    });

    // Fire session creation in background; resolve to boolean for ChatPanel.
    // Timeout prevents indefinite stall on cold start / slow network.
    const abortCtl = new AbortController();
    const timeout = setTimeout(() => abortCtl.abort(), 15_000);
    const ready = fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        model: model ?? DEFAULT_MODEL,
        ...(voice ? { voice_id: voice } : {}),
        aspect_ratio: ratioOverride ?? aspectRatio,
      }),
      signal: abortCtl.signal,
    }).then(r => r.ok).catch(() => false as const).then((ok) => {
      if (!ok) {
        pendingWelcomePayloadRef.current.delete(id);
      }
      return ok;
    }).finally(() => {
      clearTimeout(timeout);
      sessionCreationRef.current = null;
    });
    sessionCreationRef.current = { id, ready };
    setPendingSessionReady({ id, ready });

    // Navigate immediately — user sees their message + "Working..." without waiting
    router.push(`/?session=${id}`);
  }, [router, aspectRatio]);

  // Determine UX stage
  const isWelcome = !activeSessionId && !isLibraryActive && !isFeedbackActive;

  useEffect(() => {
    if (isWelcome) return;
    appliedLaunchAspectRef.current = null;
    consumedLaunchAutoSendRef.current = null;
  }, [isWelcome]);

  // Apply deep-link aspect ratio once per URL in welcome mode.
  useEffect(() => {
    if (!isWelcome || !launchIntent?.aspectRatio) return;
    if (appliedLaunchAspectRef.current === searchParamsString) return;
    appliedLaunchAspectRef.current = searchParamsString;
    setAspectRatio(launchIntent.aspectRatio);
  }, [isWelcome, launchIntent?.aspectRatio, searchParamsString, setAspectRatio]);

  // Optional deep-link auto-send: /?prompt=...&send=1
  useEffect(() => {
    if (!isWelcome || !launchIntent || !launchIntent.autoSend) return;
    const key = `auto:${searchParamsString}`;
    if (consumedLaunchAutoSendRef.current === key) return;
    consumedLaunchAutoSendRef.current = key;
    handleWelcomeSend(
      launchIntent.prompt,
      undefined,
      launchIntent.model,
      launchIntent.voiceId,
      launchIntent.aspectRatio,
    );
  }, [isWelcome, launchIntent, searchParamsString, handleWelcomeSend]);

  // Close mobile sidebar when navigating to a session
  const handleMobileSessionSelect = useCallback((sessionId: string) => {
    setMobileSidebarOpen(false);
    handleSessionSelect(sessionId);
  }, [handleSessionSelect]);

  const handleMobileNewSession = useCallback(() => {
    setMobileSidebarOpen(false);
    handleNewSession();
  }, [handleNewSession]);

  const handleMobileLibraryClick = useCallback(() => {
    setMobileSidebarOpen(false);
    handleLibraryClick();
  }, [handleLibraryClick]);

  const handleMobileFeedbackClick = useCallback(() => {
    setMobileSidebarOpen(false);
    handleFeedbackClick();
  }, [handleFeedbackClick]);

  if (isSharedImportActive) {
    return (
      <SharedImportView
        token={shareToken}
        onCreated={(sessionId) => router.replace(`/?session=${encodeURIComponent(sessionId)}`)}
        onCancel={() => router.replace("/")}
      />
    );
  }

  if (cloudAuthStatus.status !== "connected") {
    return (
      <CloudAuthGate
        isLoading={cloudAuthLoading}
        status={cloudAuthStatus}
        onRetry={reconnectCloudAuth}
      />
    );
  }

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      {/* Sidebar - overlay on mobile, inline on desktop */}
      {isMobile ? (
        <>
          {/* Backdrop */}
          {mobileSidebarOpen && (
            <div
              onClick={() => setMobileSidebarOpen(false)}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(0,0,0,0.3)",
                zIndex: 49,
              }}
            />
          )}
          {/* Drawer */}
          <div style={{
            position: "fixed", top: 0, left: 0, bottom: 0,
            width: 280,
            zIndex: 50,
            transform: mobileSidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 250ms ease-in-out",
          }}>
            <SessionsSidebar
              activeSessionId={activeSessionId}
              onSessionSelect={handleMobileSessionSelect}
              onNewSession={handleMobileNewSession}
              isCollapsed={false}
              onToggleCollapse={() => setMobileSidebarOpen(false)}
              isLibraryActive={isLibraryActive}
              isFeedbackActive={isFeedbackActive}
              onLibraryClick={handleMobileLibraryClick}
              onFeedbackClick={handleMobileFeedbackClick}
              cloudAuthStatus={cloudAuthStatus}
              onStudioCloudReconnect={reconnectCloudAuth}
            />
          </div>
        </>
      ) : (
        <div style={{
          width: sidebarCollapsed ? 52 : 260,
          flexShrink: 0,
          transition: "width 200ms ease-in-out",
        }}>
          <SessionsSidebar
            activeSessionId={activeSessionId}
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            isCollapsed={sidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
            isLibraryActive={isLibraryActive}
            isFeedbackActive={isFeedbackActive}
            onLibraryClick={handleLibraryClick}
            onFeedbackClick={handleFeedbackClick}
            cloudAuthStatus={cloudAuthStatus}
            onStudioCloudReconnect={reconnectCloudAuth}
          />
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{
            display: "flex", alignItems: "center",
            padding: "10px 16px",
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setMobileSidebarOpen(true)}
              style={{
                width: 36, height: 36,
                borderRadius: 8, border: "none",
                background: "transparent",
                color: "var(--icon-secondary)",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <span style={{
              fontSize: 17, fontWeight: 400,
              fontFamily: "var(--font-display)",
              color: "var(--text-primary)",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ fontSize: 20, fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif", color: "var(--accent)" }}>∑</span>
              Manimate
            </span>
            <div style={{ flex: 1 }} />
          </div>
        )}

        {isLibraryActive || isFeedbackActive ? (
          <LibraryView
            mode={isFeedbackActive ? "feedback" : "videos"}
            initialSelectedSessionId={isFeedbackActive ? feedbackSessionId : null}
            onSessionSelect={handleSessionSelect}
          />
        ) : isWelcome ? (
          <WelcomeView
            onSend={handleWelcomeSend}
            onPrewarm={handlePrewarm}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            isMobile={isMobile}
            initialPrompt={launchIntent?.prompt}
            initialModel={launchIntent?.model}
            initialVoice={launchIntent?.voiceId}
          />
        ) : (
          <ChatPanel
            key={activeSessionId}
            sessionId={activeSessionId}
            onSessionAspectRatio={setAspectRatio}
            hasPendingWelcomePayload={hasPendingWelcomePayload}
            consumeWelcomePayload={consumeWelcomePayload}
            isMobile={isMobile}
            sessionReady={
              pendingSessionReady?.id === activeSessionId
                ? pendingSessionReady.ready
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

function SharedImportView({
  token,
  onCreated,
  onCancel,
}: {
  token: string | null;
  onCreated: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Copying shared session...");
  const startedRef = useRef(false);

  const startImport = useCallback(async () => {
    setState("loading");
    setMessage("Copying shared session...");

    try {
      const response = await fetch("/api/share-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || typeof payload.session?.id !== "string") {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Failed to continue shared session locally",
        );
      }

      setMessage("Opening local session...");
      onCreated(payload.session.id);
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to continue shared session locally",
      );
    }
  }, [onCreated, token]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startImport();
  }, [startImport]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-main)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          border: "1px solid var(--border-main)",
          borderRadius: 16,
          background: "var(--bg-white)",
          boxShadow: "0 20px 46px rgba(15, 23, 42, 0.10)",
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: state === "loading" ? "rgba(43,181,160,0.12)" : "rgba(220,38,38,0.10)",
              color: state === "loading" ? "var(--accent)" : "#b91c1c",
              flexShrink: 0,
            }}
          >
            {state === "loading" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 7h10v10H7z" />
                <path d="M4 4h10" />
                <path d="M4 4v10" />
                <path d="M20 10v10" />
                <path d="M10 20h10" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: 1.2, fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
              Continue locally
            </div>
            <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.45, color: state === "error" ? "#b91c1c" : "var(--text-secondary)" }}>
              {message}
            </div>
          </div>
        </div>

        {state === "loading" ? (
          <div
            aria-hidden="true"
            style={{
              marginTop: 18,
              height: 4,
              borderRadius: 999,
              overflow: "hidden",
              background: "var(--bg-hover)",
            }}
          >
            <div
              style={{
                width: "45%",
                height: "100%",
                borderRadius: 999,
                background: "var(--accent)",
              }}
            />
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                border: "1px solid var(--border-main)",
                background: "var(--bg-white)",
                color: "var(--text-secondary)",
                borderRadius: 9,
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "var(--font)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void startImport(); }}
              style={{
                border: "1px solid rgba(43,181,160,0.28)",
                background: "var(--accent)",
                color: "white",
                borderRadius: 9,
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font)",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Welcome page component
function WelcomeView({
  onSend,
  onPrewarm,
  aspectRatio,
  onAspectRatioChange,
  isMobile = false,
  initialPrompt,
  initialModel,
  initialVoice,
}: {
  onSend: (prompt: string, images?: File[], model?: string, voice?: string, ratioOverride?: AspectRatio) => void;
  onPrewarm?: () => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  isMobile?: boolean;
  initialPrompt?: string;
  initialModel?: string;
  initialVoice?: string;
}) {
  const [model, setModel] = usePreferredModel();
  const [voice, setVoice] = usePreferredVoice();
  const appliedInitialModelRef = useRef<string | null>(null);
  const appliedInitialVoiceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialModel) return;
    if (appliedInitialModelRef.current === initialModel) return;
    appliedInitialModelRef.current = initialModel;
    setModel(initialModel);
  }, [initialModel, setModel]);

  useEffect(() => {
    if (!initialVoice) return;
    if (appliedInitialVoiceRef.current === initialVoice) return;
    appliedInitialVoiceRef.current = initialVoice;
    setVoice(initialVoice);
  }, [initialVoice, setVoice]);

  const handleSend = useCallback((prompt: string, images?: File[]) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && (!images || images.length === 0)) return;
    onSend(trimmedPrompt, images, model, voice);
  }, [model, voice, onSend]);

  return (
    <div style={{
      flex: 1,
      display: "flex", flexDirection: "column",
      alignItems: "center",
      background: "var(--bg-main)",
      padding: isMobile ? "20px 16px" : 40,
    }}>
      <div style={{ flex: 1 }} />

      <div style={{ marginBottom: 20 }}>
        <StudioPlanPill />
      </div>

      <div style={{
        fontSize: isMobile ? 26 : 36, fontWeight: 400,
        fontFamily: "var(--font-display)",
        color: "var(--text-primary)",
        marginBottom: isMobile ? 20 : 32,
        letterSpacing: -0.3,
        textAlign: "center",
      }}>
        What can I animate for you?
      </div>

      <div style={{ width: "100%", maxWidth: isMobile ? "100%" : 620 }}>
        <ChatInput
          onSend={handleSend}
          onPrewarm={onPrewarm}
          placeholder="Describe a math concept to animate..."
          draftKey="chat-draft:welcome"
          initialPrompt={initialPrompt}
          extraLeft={
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 6, flexWrap: "wrap" }}>
              <ModelSelector model={model} onChange={setModel} />
              <VoiceSelector voice={voice} onChange={setVoice} />
              <AspectRatioSelector ratio={aspectRatio} onChange={onAspectRatioChange} />
            </div>
          }
        />
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}

export default function HomeClient({ initialCloudAuthStatus }: { initialCloudAuthStatus: CloudAuthStatus }) {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 32, height: 32,
          borderRadius: "50%",
          border: "2px solid var(--border-input)",
          borderTopColor: "var(--accent)",
          animation: "spin 1s linear infinite",
        }} />
      </div>
    }>
      <HomeContent initialCloudAuthStatus={initialCloudAuthStatus} />
    </Suspense>
  );
}

