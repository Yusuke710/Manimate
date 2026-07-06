"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import HandoffButton from "@/components/HandoffButton";
import ShareProjectButton from "@/components/ShareProjectButton";
import { CodeTab, PlanTab } from "@/components/ArtifactTabs";
import { PreviewTab } from "@/components/PreviewTab";
import { buildPreviewLoadKey } from "@/lib/preview-load";


type Tab = "plan" | "code" | "preview";

interface PreviewPanelProps {
  videoUrl: string | null;
  videoUpdateNonce?: number;
  sandboxId: string | null;
  sessionId?: string | null;
  planContent?: string | null;
  scriptContent?: string | null;
  sessionModel?: string | null;
  isRendering?: boolean;
  onRequestHqRender?: () => boolean;
  onRequest4kRender?: () => boolean;
  onPreviewReady?: (previewNonce: number) => void;
}


export default function PreviewPanel({ videoUrl, videoUpdateNonce = 0, sandboxId, sessionId, planContent = null, scriptContent = null, sessionModel = null, isRendering = false, onRequestHqRender, onRequest4kRender, onPreviewReady }: PreviewPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [effectiveVideoUrl, setEffectiveVideoUrl] = useState<string | null>(videoUrl);
  const [previewReadyKey, setPreviewReadyKey] = useState<string | null>(null);
  // Track whether user has manually selected a tab (suppresses auto-switch)
  const userSelectedTabRef = useRef(false);

  // Track previous videoUrl to detect changes
  const prevVideoUrlRef = useRef(videoUrl);
  const activePreviewKey = effectiveVideoUrl
    ? buildPreviewLoadKey(effectiveVideoUrl, videoUpdateNonce)
    : null;
  const isVideoPlayable = activePreviewKey !== null && previewReadyKey === activePreviewKey;

  // Sync effectiveVideoUrl when videoUrl prop changes.
  useEffect(() => {
    if (videoUrl !== prevVideoUrlRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing controlled preview state from parent props
      setEffectiveVideoUrl(videoUrl);
      userSelectedTabRef.current = false;
      prevVideoUrlRef.current = videoUrl;
    }
  }, [videoUrl]);

  const handleTabClick = useCallback((tab: Tab) => {
    userSelectedTabRef.current = true;
    setActiveTab(tab);
  }, []);

  const tabs: { id: Tab; label: string; ready: boolean }[] = [
    { id: "plan", label: "Plan", ready: !!planContent },
    { id: "code", label: "Code", ready: !!scriptContent },
    { id: "preview", label: "Preview", ready: isVideoPlayable },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-main)" }}>
      {/* Video wrapper with tabs */}
      <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden", borderRadius: 12, background: "var(--bg-card)", border: "1px solid var(--border-main)", margin: 12 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--border-main)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                data-testid={`tab-${tab.id}`}
                onClick={() => handleTabClick(tab.id)}
                style={{
                  position: "relative",
                  padding: "5px 14px",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  transition: "all 0.12s",
                  background: activeTab === tab.id ? "var(--bg-white)" : "transparent",
                  color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-tertiary)",
                  boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                }}
                onMouseEnter={(e) => { if (activeTab !== tab.id) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (activeTab !== tab.id) e.currentTarget.style.background = "transparent"; }}
              >
                {tab.label}
                {tab.ready && (
                  <span style={{
                    position: "absolute", top: -1, right: -1,
                    width: 5, height: 5,
                    background: "var(--accent)",
                    borderRadius: "50%",
                  }} />
                )}
              </button>
            ))}

          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          <HandoffButton
            sessionId={sessionId}
            hasPlan={Boolean(planContent)}
            hasCode={Boolean(scriptContent)}
            hasVideo={Boolean(effectiveVideoUrl)}
            onCreated={(nextSessionId) => router.push(`/?session=${nextSessionId}`)}
          />
          <ShareProjectButton sessionId={sessionId} />
        </div>

        {/* Tab content - all tabs rendered but hidden for preloading */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
          <div data-testid="panel-plan" style={{ position: "absolute", inset: 0, overflow: "auto", visibility: activeTab === "plan" ? "visible" : "hidden" }}>
            <PlanTab content={planContent} />
          </div>
          <div data-testid="panel-code" style={{ position: "absolute", inset: 0, overflow: "auto", visibility: activeTab === "code" ? "visible" : "hidden" }}>
            <CodeTab content={scriptContent} />
          </div>
          <div data-testid="panel-preview" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", visibility: activeTab === "preview" ? "visible" : "hidden" }}>
            <PreviewTab videoUrl={effectiveVideoUrl} videoRefreshNonce={videoUpdateNonce} sandboxId={sandboxId} sessionId={sessionId} sessionModel={sessionModel} isVisible={activeTab === "preview"} isRendering={isRendering} onRequestHqRender={onRequestHqRender} onRequest4kRender={onRequest4kRender} onCanPlay={() => {
              if (activePreviewKey && previewReadyKey !== activePreviewKey) {
                setPreviewReadyKey(activePreviewKey);
                onPreviewReady?.(videoUpdateNonce);
              }
              if (!userSelectedTabRef.current) setActiveTab("preview");
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

