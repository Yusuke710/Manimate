"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import ShareButton from "@/components/ShareButton";
import HandoffButton from "@/components/HandoffButton";
import { CodeTab } from "@/components/ArtifactTabs";
import { PreviewTab } from "@/components/PreviewTab";
import { buildPreviewLoadKey } from "@/lib/preview-load";


type Tab = "code" | "preview";

interface PreviewPanelProps {
  videoUrl: string | null;
  videoUpdateNonce?: number;
  sessionId?: string | null;
  scriptContent?: string | null;
  sessionModel?: string | null;
  isRendering?: boolean;
  onPreviewReady?: (previewNonce: number) => void;
}


export default function PreviewPanel({ videoUrl, videoUpdateNonce = 0, sessionId, scriptContent = null, sessionModel = null, isRendering = false, onPreviewReady }: PreviewPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("code");
  const [previewReadyKey, setPreviewReadyKey] = useState<string | null>(null);
  // Track whether user has manually selected a tab (suppresses auto-switch)
  const userSelectedTabRef = useRef(false);
  useEffect(() => { userSelectedTabRef.current = false; }, [videoUrl]);

  const activePreviewKey = videoUrl ? buildPreviewLoadKey(videoUrl, videoUpdateNonce) : null;
  const isVideoPlayable = activePreviewKey !== null && previewReadyKey === activePreviewKey;

  const tabs: { id: Tab; label: string; ready: boolean }[] = [
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
                onClick={() => { userSelectedTabRef.current = true; setActiveTab(tab.id); }}
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
            hasCode={Boolean(scriptContent)}
            hasVideo={Boolean(videoUrl)}
            onCreated={(nextSessionId) => router.push(`/?session=${nextSessionId}`)}
          />
          {sessionId && <ShareButton key={sessionId} sessionId={sessionId} disabled={!videoUrl || isRendering} />}
        </div>

        {/* Tab content - all tabs rendered but hidden for preloading */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
          <div data-testid="panel-code" style={{ position: "absolute", inset: 0, overflow: "auto", visibility: activeTab === "code" ? "visible" : "hidden" }}>
            <CodeTab content={scriptContent} />
          </div>
          <div data-testid="panel-preview" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", visibility: activeTab === "preview" ? "visible" : "hidden" }}>
            <PreviewTab videoUrl={videoUrl} videoRefreshNonce={videoUpdateNonce} sessionId={sessionId} sessionModel={sessionModel} isVisible={activeTab === "preview"} onCanPlay={() => {
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

