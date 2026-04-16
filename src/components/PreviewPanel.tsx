"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";

import {
  buildPreviewAssetLoadKey,
  buildPreviewLoadKey,
  shouldAcceptPreviewAsyncResult,
} from "@/lib/preview-load";
import { normalizeChaptersToVideoDuration } from "@/lib/timeline";
import { useIsMobile } from "@/lib/useIsMobile";

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

// Shared placeholder component
function Placeholder({ message, testId, icon }: { message: string; testId?: string; icon?: "document" | "code" | "video" }) {
  const icons = {
    document: (
      <svg viewBox="0 0 24 24" style={{ width: 48, height: 48, fill: "var(--text-tertiary)", marginBottom: 16 }}>
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
      </svg>
    ),
    code: (
      <svg viewBox="0 0 24 24" style={{ width: 48, height: 48, fill: "var(--text-tertiary)", marginBottom: 16 }}>
        <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
      </svg>
    ),
    video: (
      <svg viewBox="0 0 24 24" style={{ width: 48, height: 48, fill: "var(--text-tertiary)", marginBottom: 16 }}>
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
      </svg>
    ),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, textAlign: "center", padding: 40 }} data-testid={testId}>
      {icon && icons[icon]}
      <p style={{ color: "var(--text-tertiary)", fontSize: 14 }}>{message}</p>
    </div>
  );
}

const PlanTab = memo(function PlanTab({
  content,
}: {
  content: string | null;
}) {
  const renderedHtml = useMemo(() => (content ? markdownToHtml(content) : ""), [content]);
  const html = useMemo(() => ({ __html: renderedHtml }), [renderedHtml]);

  if (!content) {
    return <Placeholder message="No plan.md found" icon="document" testId="plan-placeholder" />;
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", background: "var(--bg-white)" }} data-testid="plan-viewer">
      <div
        className="plan-content"
        style={{ padding: 24 }}
        dangerouslySetInnerHTML={html}
      />
      <style jsx>{`
        .plan-content {
          color: var(--text-primary);
          line-height: 1.7;
          font-size: 15px;
        }
        .plan-content :global(h1) {
          font-size: 24px;
          font-weight: 600;
          margin: 0 0 16px;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-main);
          padding-bottom: 8px;
        }
        .plan-content :global(h2) {
          font-size: 20px;
          font-weight: 600;
          margin: 24px 0 12px;
          color: var(--text-primary);
        }
        .plan-content :global(h3) {
          font-size: 16px;
          font-weight: 600;
          margin: 20px 0 8px;
          color: var(--text-primary);
        }
        .plan-content :global(p) {
          margin: 0 0 12px;
        }
        .plan-content :global(ul), .plan-content :global(ol) {
          margin: 0 0 12px;
          padding-left: 24px;
        }
        .plan-content :global(li) {
          margin: 4px 0;
        }
        .plan-content :global(code) {
          background: var(--bg-hover);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 13px;
        }
        .plan-content :global(pre) {
          background: #1f2937;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 0 0 16px;
        }
        .plan-content :global(pre code) {
          background: transparent;
          padding: 0;
          color: #e5e7eb;
        }
        .plan-content :global(blockquote) {
          border-left: 3px solid var(--text-tertiary);
          padding-left: 16px;
          margin: 0 0 12px;
          color: var(--text-secondary);
        }
        .plan-content :global(strong) {
          color: var(--text-primary);
        }
        .plan-content :global(a) {
          color: var(--accent);
          text-decoration: none;
        }
        .plan-content :global(a:hover) {
          text-decoration: underline;
        }
        .plan-content :global(hr) {
          border: none;
          border-top: 1px solid var(--border-main);
          margin: 24px 0;
        }
      `}</style>
    </div>
  );
});

function markdownToHtml(markdown: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = esc(markdown);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^(\s*)[-*] (.+)$/gm, '$1<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m + '</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.split('\n\n').map(p => {
    p = p.trim();
    if (!p || p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') || p.startsWith('<pre') || p.startsWith('<blockquote') || p.startsWith('<hr')) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

const CodeTab = memo(function CodeTab({
  content,
}: {
  content: string | null;
}) {
  const { highlighted, lineCount } = useMemo(() => {
    if (!content) return { highlighted: "", lineCount: 0 };
    return { highlighted: highlightPython(content), lineCount: content.split('\n').length };
  }, [content]);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  const handleCopy = () => {
    if (!content || !navigator.clipboard) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  if (!content) {
    return <Placeholder message="No script.py found" icon="code" testId="code-placeholder" />;
  }

  return (
    <div className="code-viewer-root" data-testid="code-viewer">
      {/* Toolbar header */}
      <div className="code-toolbar">
        <div className="code-toolbar-left">
          <span className="code-toolbar-lang">Python</span>
          <span className="code-toolbar-filename">script.py</span>
          <span className="code-toolbar-meta">{lineCount} lines</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="code-copy-btn"
          data-copied={copied || undefined}
        >
          {copied ? (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
            </svg>
          )}
          <span className="code-copy-label">{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
      <style jsx>{`
        .code-viewer-root {
          width: 100%;
          height: 100%;
          overflow: auto;
          background: #111113;
          display: flex;
          flex-direction: column;
        }
        .code-toolbar {
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          height: 36px;
          min-height: 36px;
          background: #1c1c1f;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .code-toolbar-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .code-toolbar-lang {
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: #3b82f6;
          background: rgba(59,130,246,0.1);
          padding: 2px 7px;
          border-radius: 4px;
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        }
        .code-toolbar-filename {
          font-size: 12px;
          color: #a1a1aa;
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        }
        .code-toolbar-meta {
          font-size: 11px;
          color: #52525b;
        }
        .code-copy-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          color: #71717a;
          font-size: 12px;
          font-family: inherit;
          transition: all 0.15s ease;
        }
        .code-copy-btn:hover {
          background: rgba(255,255,255,0.06);
          border-color: rgba(255,255,255,0.08);
          color: #d4d4d8;
        }
        .code-copy-btn[data-copied] {
          color: var(--accent);
        }
        .code-copy-label {
          font-size: 12px;
          line-height: 1;
        }
        pre {
          margin: 0;
          padding: 16px;
          background: #111113;
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 13px;
          line-height: 1.6;
          flex: 1;
        }
        pre :global(.code-line) {
          display: flex;
        }
        pre :global(.code-line:hover) {
          background: rgba(255,255,255,0.03);
        }
        pre :global(.line-number) {
          color: #3f3f46;
          text-align: right;
          padding-right: 16px;
          min-width: 50px;
          user-select: none;
        }
        pre :global(.line-content) {
          flex: 1;
          white-space: pre;
          color: #d4d4d4;
        }
        pre :global(.hl-keyword) { color: #c586c0; }
        pre :global(.hl-string) { color: #ce9178; }
        pre :global(.hl-comment) { color: #6a9955; }
        pre :global(.hl-function) { color: #dcdcaa; }
        pre :global(.hl-class) { color: #4ec9b0; }
        pre :global(.hl-number) { color: #b5cea8; }
        pre :global(.hl-decorator) { color: #d7ba7d; }
        pre :global(.hl-builtin) { color: #4fc1ff; }
      `}</style>
    </div>
  );
});

function highlightPython(code: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const keywords = new Set(['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'import', 'from', 'return', 'yield', 'raise', 'pass', 'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'lambda', 'True', 'False', 'None', 'self', 'async', 'await']);
  const builtins = new Set(['print', 'range', 'len', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'super', 'isinstance', 'type', 'open', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed', 'min', 'max', 'sum', 'abs', 'any', 'all']);

  return code.split('\n').map((line, lineNum) => {
    let result = '', i = 0;
    while (i < line.length) {
      if (line.slice(i, i + 3) === '"""' || line.slice(i, i + 3) === "'''") {
        const quote = line.slice(i, i + 3);
        let end = line.indexOf(quote, i + 3);
        if (end === -1) end = line.length - 3;
        result += `<span class="hl-string">${esc(line.slice(i, end + 3))}</span>`;
        i = end + 3;
      } else if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        let j = i + 1;
        while (j < line.length && (line[j] !== quote || line[j - 1] === '\\')) j++;
        result += `<span class="hl-string">${esc(line.slice(i, j + 1))}</span>`;
        i = j + 1;
      } else if (line[i] === '#') {
        result += `<span class="hl-comment">${esc(line.slice(i))}</span>`;
        break;
      } else if (line[i] === '@' && /\w/.test(line[i + 1] || '')) {
        let j = i + 1;
        while (j < line.length && /\w/.test(line[j])) j++;
        result += `<span class="hl-decorator">${esc(line.slice(i, j))}</span>`;
        i = j;
      } else if (/\d/.test(line[i]) && (i === 0 || !/\w/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[\d.]/.test(line[j])) j++;
        result += `<span class="hl-number">${esc(line.slice(i, j))}</span>`;
        i = j;
      } else if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < line.length && /\w/.test(line[j])) j++;
        const word = line.slice(i, j), nextChar = line[j] || '';
        if (keywords.has(word)) result += `<span class="hl-keyword">${esc(word)}</span>`;
        else if (builtins.has(word) && nextChar === '(') result += `<span class="hl-builtin">${esc(word)}</span>`;
        else if (i >= 4 && line.slice(i - 4, i) === 'def ') result += `<span class="hl-function">${esc(word)}</span>`;
        else if (i >= 6 && line.slice(i - 6, i) === 'class ') result += `<span class="hl-class">${esc(word)}</span>`;
        else result += esc(word);
        i = j;
      } else {
        result += esc(line[i]);
        i++;
      }
    }
    return `<div class="code-line"><span class="line-number">${lineNum + 1}</span><span class="line-content">${result || ' '}</span></div>`;
  }).join('');
}

// Format time helper
const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface PreviewPlaybackSnapshot {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isEnded: boolean;
  playbackSpeed: number;
  isPaused: boolean;
}

export function getPreviewPlaybackSnapshot(
  video: Pick<HTMLVideoElement, "currentTime" | "duration" | "paused" | "ended" | "playbackRate">
): PreviewPlaybackSnapshot {
  return {
    currentTime: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
    duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
    isPlaying: !video.paused && !video.ended,
    isEnded: video.ended,
    playbackSpeed: Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1,
    isPaused: video.paused,
  };
}

// Subtitle type
interface Subtitle {
  start: number;
  end: number;
  text: string;
}

// Chapter type
interface Chapter {
  name: string;
  start: number;
  duration: number;
}

// Parse SRT file content
function parseSRT(srtText: string): Subtitle[] {
  // Normalize line endings to \n and split on double newlines
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);

  console.log('[Subtitles] Parsing', blocks.length, 'blocks');

  return blocks.map((block, idx) => {
    const lines = block.split('\n');
    // Time code is on line 1 (after the index number)
    const timeMatch = lines[1]?.match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!timeMatch) {
      console.log('[Subtitles] Block', idx, 'failed to parse:', lines[1]);
      return null;
    }
    const start = +timeMatch[1] * 3600 + +timeMatch[2] * 60 + +timeMatch[3] + +timeMatch[4] / 1000;
    const end = +timeMatch[5] * 3600 + +timeMatch[6] * 60 + +timeMatch[7] + +timeMatch[8] / 1000;
    const subtitleText = lines.slice(2).join('\n');
    return { start, end, text: subtitleText };
  }).filter((s): s is Subtitle => s !== null);
}

// Throttle interval for scrubbing (ms) - balances responsiveness vs network requests
const SCRUB_THROTTLE_MS = 100;
const FETCH_RETRY_MAX_ATTEMPTS = 5;
const FETCH_RETRY_DELAY_MS = 2000;

function runRetryingLoad(
  loader: (signal: AbortSignal) => Promise<boolean>
): () => void {
  const abortController = new AbortController();
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;

  const attemptLoad = async () => {
    let success = false;
    try {
      success = await loader(abortController.signal);
    } catch {
      success = false;
    }

    if (success || abortController.signal.aborted) return;
    if (retryCount >= FETCH_RETRY_MAX_ATTEMPTS) return;

    retryCount += 1;
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      void attemptLoad();
    }, FETCH_RETRY_DELAY_MS);
  };

  void attemptLoad();

  return () => {
    abortController.abort();
    if (retryTimeout) clearTimeout(retryTimeout);
  };
}

/** Build download filename: manimate-{model}-{shortId}.mp4 (Runway-style) */
function toFilename(sessionId: string | null, model: string | null, suffix: string): string {
  const shortId = sessionId?.slice(0, 8) ?? "unknown";
  // Replace dots in model names (e.g. "claude-opus-4.6" → "claude-opus-4-6")
  const safeModel = (model ?? "video").replace(/\./g, "-");
  return `manimate-${safeModel}-${shortId}${suffix}.mp4`;
}

export function PreviewTab({ videoUrl, videoRefreshNonce = 0, sandboxId, sessionId, sessionModel = null, isVisible = true, isRendering = false, onRequestHqRender, onRequest4kRender, onCanPlay }: { videoUrl: string | null; videoRefreshNonce?: number; sandboxId: string | null; sessionId?: string | null; sessionModel?: string | null; isVisible?: boolean; isRendering?: boolean; onRequestHqRender?: () => boolean; onRequest4kRender?: () => boolean; onCanPlay?: () => void }) {
  // Compute full video URL first (before any hooks that use it)
  const fullVideoUrl = videoUrl?.startsWith("http") || videoUrl?.startsWith("/") ? videoUrl : null;

  const videoRef = useRef<HTMLVideoElement>(null);

  const progressBarRef = useRef<HTMLDivElement>(null);
  // Refs for throttled scrubbing - reduces Range requests during drag
  const pendingSeekTimeRef = useRef<number | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track dragging state for event handlers (avoids stale closure issues)
  const isDraggingRef = useRef(false);
  // Ref to track if actual mouse movement happened (distinguishes click from drag)
  const didMoveRef = useRef(false);
  // Ref to suppress click after drag (prevents extra seek on mouseup)
  const justDraggedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [subtitleSize, setSubtitleSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Menu state — finite state instead of independent booleans
  type OpenMenu = 'none' | 'settings' | 'more';
  type OpenSubmenu = 'none' | 'speed' | 'size';
  const [openMenu, setOpenMenu] = useState<OpenMenu>('none');
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu>('none');
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const closeMenus = () => { setOpenMenu('none'); setOpenSubmenu('none'); };
  const isMobile = useIsMobile();
  const [isDragging, setIsDragging] = useState(false);
  // Double-tap seek (mobile YouTube-style)
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [doubleTapFeedback, setDoubleTapFeedback] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const doubleTapKeyRef = useRef(0);
  // Touch scrubbing state
  const [isTouchScrubbing, setIsTouchScrubbing] = useState(false);
  // Cleanup tap timers on unmount
  useEffect(() => () => {
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
  }, []);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);
  // Refs for tracking loaded preview asset requests.
  const lastSubtitleUrlRef = useRef<string | null>(null);
  const lastChaptersUrlRef = useRef<string | null>(null);

  // withSwapVersionParam removed: appending ad-hoc query params can break signed URLs.
  // Cache busting is unnecessary because refreshed assets already produce a new URL.

  // Reset all state when sessionId changes to prevent data bleeding between sessions
  const prevSessionIdRef = useRef(sessionId);
  useEffect(() => {
    // Only reset on actual session change, not initial mount
    if (prevSessionIdRef.current === sessionId) return;
    prevSessionIdRef.current = sessionId;

    setSubtitles([]);
    setChapters([]);
    setCurrentSubtitle('');
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsEnded(false);
    lastSubtitleUrlRef.current = null;
    lastChaptersUrlRef.current = null;
  }, [sessionId]);

  // Reset URL tracking refs and clear stale data when any preview load changes.
  const prevVideoUrlRef = useRef<string | null>(null);
  const prevVideoRefreshNonceRef = useRef(videoRefreshNonce);
  useEffect(() => {
    const videoChanged = videoUrl !== prevVideoUrlRef.current;
    const nonceChanged = videoRefreshNonce !== prevVideoRefreshNonceRef.current;

    if (videoChanged || nonceChanged) {
      // Do not keep stale segmentation/subtitles visible while the next preview loads.
      lastSubtitleUrlRef.current = null;
      lastChaptersUrlRef.current = null;
      setSubtitles([]);
      setChapters([]);
      setCurrentSubtitle('');
    }
    prevVideoUrlRef.current = videoUrl;
    prevVideoRefreshNonceRef.current = videoRefreshNonce;
  }, [videoUrl, videoRefreshNonce]);

  const requestedVideoLoadKey = buildPreviewLoadKey(fullVideoUrl, videoRefreshNonce);
  const requestedVideoLoadKeyRef = useRef(requestedVideoLoadKey);
  requestedVideoLoadKeyRef.current = requestedVideoLoadKey;

  // Reset playback UI when a new preview is requested.
  useEffect(() => {
    if (!fullVideoUrl) return;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsEnded(false);
  }, [requestedVideoLoadKey, fullVideoUrl]);

  const syncPlaybackState = useCallback((
    video: Pick<HTMLVideoElement, "currentTime" | "duration" | "paused" | "ended" | "playbackRate">,
    options?: { syncCurrentTime?: boolean },
  ) => {
    const snapshot = getPreviewPlaybackSnapshot(video);
    if (options?.syncCurrentTime !== false && !isDraggingRef.current) {
      setCurrentTime(snapshot.currentTime);
    }
    setDuration(snapshot.duration);
    setIsPlaying(snapshot.isPlaying);
    setIsEnded(snapshot.isEnded);
    setPlaybackSpeed(snapshot.playbackSpeed);
  }, []);

  const refreshPlaybackState = useCallback((options?: { syncCurrentTime?: boolean }) => {
    const video = videoRef.current;
    if (!video || !fullVideoUrl) return;
    syncPlaybackState(video, options);
  }, [fullVideoUrl, syncPlaybackState]);

  const handleVideoCanPlay = useCallback((video: HTMLVideoElement) => {
    if (!fullVideoUrl || video !== videoRef.current) return;
    refreshPlaybackState();
    onCanPlay?.();
  }, [fullVideoUrl, onCanPlay, refreshPlaybackState]);

  // Gate on fullVideoUrl to avoid fetching before video exists.
  const fullSubtitleUrl = fullVideoUrl && sessionId
    ? `/api/subtitles?session_id=${encodeURIComponent(sessionId)}`
    : null;
  const subtitleLoadKey = buildPreviewAssetLoadKey(
    requestedVideoLoadKey,
    fullSubtitleUrl
  );

  // Note: We no longer poll sandbox for video existence.
  // Videos are served from CDN and existence is determined by fullVideoUrl being set.

  // Construct chapters URL - uses session_id to fetch persisted chapters from DB
  const fullChaptersUrl = sessionId
    ? `/api/chapters?session_id=${encodeURIComponent(sessionId)}`
    : null;
  const chaptersLoadKey = buildPreviewAssetLoadKey(
    requestedVideoLoadKey,
    fullChaptersUrl
  );

  // Load subtitles - fetches with retry if data not ready yet
  useEffect(() => {
    if (!fullSubtitleUrl || !subtitleLoadKey) return;
    // Skip if already successfully loaded for this preview request.
    if (lastSubtitleUrlRef.current === subtitleLoadKey) return;

    return runRetryingLoad(async (signal) => {
      const response = await fetch(fullSubtitleUrl, {
        signal,
        cache: "no-store",
      });
      if (!response.ok || signal.aborted) return false;

      const text = await response.text();
      if (!shouldAcceptPreviewAsyncResult({
        requestedLoadKey: requestedVideoLoadKeyRef.current,
        responseLoadKey: requestedVideoLoadKey,
        aborted: signal.aborted,
      })) {
        return false;
      }
      const parsed = parseSRT(text);
      if (parsed.length === 0) return false;

      lastSubtitleUrlRef.current = subtitleLoadKey;
      setSubtitlesOn(true); // Auto-enable if subtitles exist
      setSubtitles(parsed);
      return true;
    });
  }, [fullSubtitleUrl, requestedVideoLoadKey, subtitleLoadKey]);

  // Load chapters - fetches with retry if data not ready yet
  useEffect(() => {
    if (!fullChaptersUrl || !chaptersLoadKey) return;
    // Skip if already successfully loaded for this preview request.
    if (lastChaptersUrlRef.current === chaptersLoadKey) return;

    return runRetryingLoad(async (signal) => {
      const response = await fetch(fullChaptersUrl, {
        signal,
        cache: "no-store",
      });
      if (!response.ok || signal.aborted) return false;

      const data = await response.json();
      if (!shouldAcceptPreviewAsyncResult({
        requestedLoadKey: requestedVideoLoadKeyRef.current,
        responseLoadKey: requestedVideoLoadKey,
        aborted: signal.aborted,
      })) {
        return false;
      }
      if (!Array.isArray(data) || data.length === 0) return false;

      lastChaptersUrlRef.current = chaptersLoadKey;
      setChapters(data);
      return true;
    });
  }, [chaptersLoadKey, fullChaptersUrl, requestedVideoLoadKey]);

  const normalizedTimeline = useMemo(
    () => normalizeChaptersToVideoDuration(chapters, duration),
    [chapters, duration]
  );
  const timelineChapters = useMemo(
    () => normalizedTimeline?.chapters ?? [],
    [normalizedTimeline]
  );
  const useSegmentedTimeline = timelineChapters.length > 1;
  // Compute current chapter based on time (derived state)
  const currentChapter = useMemo(() => {
    if (timelineChapters.length === 0) return null;
    // Find the chapter that contains the current time
    const chapter = [...timelineChapters].reverse().find(c => currentTime >= c.start);
    return chapter || timelineChapters[0];
  }, [currentTime, timelineChapters]);

  // Update current subtitle based on time
  useEffect(() => {
    if (!subtitlesOn || subtitles.length === 0) {
      setCurrentSubtitle('');
      return;
    }
    const sub = subtitles.find(s => currentTime >= s.start && currentTime < s.end);
    setCurrentSubtitle(sub?.text || '');
  }, [currentTime, subtitles, subtitlesOn]);

  // Direct session loads can hydrate a cached video before any media event updates state.
  useEffect(() => {
    refreshPlaybackState();
  }, [requestedVideoLoadKey, refreshPlaybackState]);

  // The preview stays mounted while hidden, so resync when the tab becomes visible
  // or the page returns from the background.
  useEffect(() => {
    if (!isVisible) return;

    refreshPlaybackState();

    const handleVisibilityChange = () => {
      if (!document.hidden) refreshPlaybackState();
    };

    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("pageshow", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("pageshow", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isVisible, refreshPlaybackState]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isEnded) {
      video.currentTime = 0;
      setIsEnded(false);
    }
    if (video.paused) {
      // Catch AbortError when video source changes during play
      video.play().catch((e) => {
        if (e.name !== 'AbortError') console.error('Play error:', e);
      });
    } else {
      video.pause();
    }
  }, [isEnded]);

  // Shared helper: convert clientX to seek time using progress bar rect
  const getTimeFromClientX = useCallback((clientX: number): number | null => {
    const video = videoRef.current;
    const bar = progressBarRef.current;
    if (!video || !bar) return null;
    const videoDuration = Number.isFinite(video.duration) ? video.duration : duration;
    if (videoDuration <= 0) return null;
    const rect = bar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * videoDuration;
  }, [duration]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Suppress click if it's from a drag release (prevents extra Range request)
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    const newTime = getTimeFromClientX(e.clientX);
    if (newTime === null) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = newTime;
    setCurrentTime(newTime);
    setIsEnded(false);
  }, [getTimeFromClientX]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    // Use state duration as fallback where video.duration may transiently be NaN
    const videoDuration = Number.isFinite(video.duration) ? video.duration : duration;
    if (videoDuration <= 0) return;
    const newTime = Math.max(0, Math.min(videoDuration, video.currentTime + delta));
    video.currentTime = newTime;
    setCurrentTime(newTime); // Immediate UI update
    setIsEnded(false);
  }, [duration]);

  const changeSpeed = useCallback((speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setPlaybackSpeed(speed);
    setOpenMenu('none');
    setOpenSubmenu('none');
  }, []);

  const insertText = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("chat-insert-text", { detail: text }));
  }, []);

  const insertImage = useCallback((file: File) => {
    window.dispatchEvent(new CustomEvent("chat-add-image", { detail: file }));
  }, []);

  const captureFrameFromCanvas = useCallback((
    video: HTMLVideoElement,
    timestamp: number
  ): Promise<File | null> =>
    new Promise((resolve) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(null);
            return;
          }

          const ts = formatTime(timestamp).replace(":", "m") + "s";
          resolve(new File([blob], `${ts}.png`, { type: "image/png" }));
        }, "image/png");
      } catch {
        resolve(null);
      }
    }), []);

  const captureFrameAndInsert = useCallback((textFn: (t: number) => string) => {
    const video = videoRef.current;
    const t = video?.currentTime ?? currentTimeRef.current;
    const text = textFn(t);
    void (async () => {
      let frameFile: File | null = null;

      if (video && video.videoWidth > 0) {
        frameFile = await captureFrameFromCanvas(video, t);
      }

      if (frameFile) {
        insertImage(frameFile);
      }

      insertText(text);
    })();
  }, [captureFrameFromCanvas, insertImage, insertText, videoRef]);

  // Unified fullscreen toggle (used by keyboard shortcut, mobile button, desktop button)
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const container = videoRef.current?.closest('[data-video-container]') as HTMLElement | null;
    if (container?.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    } else {
      // iOS Safari fallback: fullscreen the video element directly
      const video = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null;
      video?.webkitEnterFullscreen?.();
    }
  }, []);

  // Mobile: timer-based tap detection (single tap = play/pause, double tap = seek ±5s)
  const handleMobileTap = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side: 'left' | 'right' = x < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    const last = lastTapRef.current;

    if (last && now - last.time < 300 && last.side === side) {
      // Double tap detected
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = null;
      seekBy(side === 'left' ? -5 : 5);
      setDoubleTapFeedback({ side, key: ++doubleTapKeyRef.current });
      setTimeout(() => setDoubleTapFeedback(null), 500);
    } else {
      // First tap - wait to see if double
      lastTapRef.current = { time: now, side };
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        lastTapRef.current = null;
        togglePlay();
      }, 300);
    }
  }, [seekBy, togglePlay]);

  // Desktop: immediate click = play/pause, native dblclick = seek ±5s (no delay)
  const handleDesktopClick = useCallback(() => { togglePlay(); }, [togglePlay]);
  const handleDesktopDblClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side: 'left' | 'right' = x < rect.width / 2 ? 'left' : 'right';
    seekBy(side === 'left' ? -5 : 5);
    setDoubleTapFeedback({ side, key: ++doubleTapKeyRef.current });
    setTimeout(() => setDoubleTapFeedback(null), 500);
  }, [seekBy]);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<'current' | 'hq' | '4k'>('current');
  const [pendingRenderDownload, setPendingRenderDownload] = useState<{
    quality: 'hq' | '4k';
    originPreviewKey: string;
    renderStarted: boolean;
  } | null>(null);

  const downloadVideoBlob = useCallback(async (url: string, filename: string) => {
    setIsDownloading(true);
    let blobUrl: string | null = null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(url, "_blank");
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setIsDownloading(false);
    }
  }, []);

  const downloadLockRef = useRef(false);
  const queueRenderAndDownload = useCallback((quality: 'hq' | '4k') => {
    const started = quality === '4k'
      ? onRequest4kRender?.() ?? false
      : onRequestHqRender?.() ?? false;
    if (!started) return false;

    setPendingRenderDownload({
      quality,
      originPreviewKey: requestedVideoLoadKey,
      renderStarted: false,
    });
    setShowDownloadModal(false);
    return true;
  }, [onRequest4kRender, onRequestHqRender, requestedVideoLoadKey]);

  useEffect(() => {
    if (!isRendering) return;
    setPendingRenderDownload((current) => {
      if (!current || current.renderStarted) return current;
      return { ...current, renderStarted: true };
    });
  }, [isRendering]);

  useEffect(() => {
    if (!pendingRenderDownload) return;

    if (requestedVideoLoadKey !== pendingRenderDownload.originPreviewKey && fullVideoUrl) {
      const suffix = pendingRenderDownload.quality === '4k' ? '-4k' : '-1080p';
      setPendingRenderDownload(null);
      void downloadVideoBlob(
        fullVideoUrl,
        toFilename(sessionId ?? null, sessionModel, suffix),
      );
      return;
    }

    if (pendingRenderDownload.renderStarted && !isRendering) {
      setPendingRenderDownload(null);
    }
  }, [
    downloadVideoBlob,
    fullVideoUrl,
    isRendering,
    pendingRenderDownload,
    requestedVideoLoadKey,
    sessionId,
    sessionModel,
  ]);

  useEffect(() => {
    setPendingRenderDownload(null);
  }, [sessionId]);

  const handleDownload = async () => {
    if (downloadLockRef.current) return;
    downloadLockRef.current = true;
    try {
      if (downloadQuality === 'current') {
        if (!fullVideoUrl) return;
        setPendingRenderDownload(null);
        await downloadVideoBlob(fullVideoUrl, toFilename(sessionId ?? null, sessionModel, ""));
        setShowDownloadModal(false);
      } else {
        queueRenderAndDownload(downloadQuality);
      }
    } finally {
      downloadLockRef.current = false;
    }
  };

  // Keyboard shortcuts - document-level listener (works regardless of focus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea or modal is open
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (showDownloadModal) return;

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'KeyJ':
          e.preventDefault();
          seekBy(-5);
          break;
        case 'ArrowRight':
        case 'KeyL':
          e.preventDefault();
          seekBy(5);
          break;
        case 'KeyC':
          if (e.metaKey || e.ctrlKey || e.altKey) break; // Don't hijack Ctrl+C / Cmd+C (copy)
          e.preventDefault();
          setSubtitlesOn(prev => !prev);
          break;
        case 'KeyT':
          e.preventDefault();
          captureFrameAndInsert((t) => `[${formatTime(t)}]: `);
          break;
        case 'KeyF':
          if (e.metaKey || e.ctrlKey || e.altKey) break; // Don't hijack Cmd+F / Ctrl+F
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seekBy, toggleFullscreen, captureFrameAndInsert, showDownloadModal]);

  // Progress bar drag handling with throttled seeking
  // Updates UI immediately but throttles video.currentTime to reduce Range requests
  useEffect(() => {
    if (!isDragging) return;

    // Track dragging state in ref for event handlers
    isDraggingRef.current = true;
    // Reset movement tracking - will be set true on first mousemove
    didMoveRef.current = false;

    const applySeek = (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = time;
      pendingSeekTimeRef.current = null;
    };

    const scheduleSeek = (time: number) => {
      pendingSeekTimeRef.current = time;
      if (throttleTimerRef.current === null) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          if (pendingSeekTimeRef.current !== null) {
            applySeek(pendingSeekTimeRef.current);
          }
        }, SCRUB_THROTTLE_MS);
      }
    };

    const handleDragMove = (clientX: number) => {
      const newTime = getTimeFromClientX(clientX);
      if (newTime === null) return;
      didMoveRef.current = true;
      setCurrentTime(newTime);
      setIsEnded(false);
      scheduleSeek(newTime);
    };

    const handleDragEnd = () => {
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      if (pendingSeekTimeRef.current !== null) {
        applySeek(pendingSeekTimeRef.current);
      }
      if (didMoveRef.current) {
        justDraggedRef.current = true;
      }
      isDraggingRef.current = false;
      setIsDragging(false);
      setIsTouchScrubbing(false);
    };

    const handleMouseMove = (e: MouseEvent) => handleDragMove(e.clientX);
    const handleMouseUp = () => handleDragEnd();
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevent page scroll while scrubbing
      if (e.touches[0]) handleDragMove(e.touches[0].clientX);
    };
    const handleTouchEnd = () => handleDragEnd();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      isDraggingRef.current = false;
    };
  }, [isDragging, getTimeFromClientX]);

  // Show placeholder if no video URL available
  if (!fullVideoUrl) {
    return (
      <Placeholder
        message={sandboxId ? "Preview will appear here when a video is generated" : "No active session. Start a chat to generate a video."}
        icon="video"
        testId="video-placeholder"
      />
    );
  }

  const progressDuration = useSegmentedTimeline
    ? normalizedTimeline?.totalDuration ?? duration
    : duration;
  const progress = progressDuration > 0
    ? Math.max(0, Math.min(100, (currentTime / progressDuration) * 100))
    : 0;

  return (
    <div data-video-container className="flex flex-col h-full bg-black relative">
      {/* Video slots */}
      <div className="flex-1 relative flex items-center justify-center min-h-0">
        <video
          key={requestedVideoLoadKey}
          ref={videoRef}
          data-testid="video-player"
          src={fullVideoUrl}
          crossOrigin="anonymous"
          className="absolute inset-0 w-full h-full object-contain z-10"
          playsInline
          preload="auto"
          onCanPlay={(event) => handleVideoCanPlay(event.currentTarget)}
          onLoadedMetadata={() => refreshPlaybackState()}
          onDurationChange={() => refreshPlaybackState({ syncCurrentTime: false })}
          onTimeUpdate={() => refreshPlaybackState()}
          onPlay={() => refreshPlaybackState({ syncCurrentTime: false })}
          onPause={() => refreshPlaybackState({ syncCurrentTime: false })}
          onEnded={() => refreshPlaybackState()}
          onRateChange={() => refreshPlaybackState({ syncCurrentTime: false })}
        >
          Your browser does not support the video tag.
        </video>

        {/* Tap/click overlay: single tap/click = play/pause, double = seek ±5s */}
        <div
          className="absolute inset-0 z-[11] cursor-pointer"
          onClick={isMobile ? handleMobileTap : handleDesktopClick}
          onDoubleClick={!isMobile ? handleDesktopDblClick : undefined}
        >
          {/* Double-tap/click seek feedback */}
          {doubleTapFeedback && (
            <div
              key={doubleTapFeedback.key}
              className={`absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 pointer-events-none ${
                doubleTapFeedback.side === 'left' ? 'left-[15%]' : 'right-[15%]'
              }`}
              style={{ animation: 'dtap-fade 0.5s ease-out forwards' }}
            >
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                {doubleTapFeedback.side === 'left' ? (
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
                )}
              </div>
              <span className="text-white text-xs font-medium">5s</span>
            </div>
          )}
        </div>

        {/* Subtitle overlay */}
        {subtitlesOn && currentSubtitle && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-center pointer-events-none max-w-[80%] z-10">
            <span className={`inline-block bg-black/75 text-white px-4 py-1.5 rounded ${
              subtitleSize === 'small' ? 'text-sm' : subtitleSize === 'large' ? 'text-2xl' : 'text-lg'
            }`}>
              {currentSubtitle}
            </span>
          </div>
        )}

        {/* Progress bar - segmented by chapters like YouTube */}
        <div
          ref={progressBarRef}
          className={`absolute bottom-12 left-3 right-3 cursor-pointer z-[15] flex items-center group ${isDragging || isTouchScrubbing ? 'dragging' : ''}`}
          style={{ height: isTouchScrubbing ? 40 : (isMobile ? 28 : 20), transition: 'height 0.15s ease' }}
          onClick={seek}
          onMouseDown={() => setIsDragging(true)}
          onTouchStart={(e) => {
            e.stopPropagation();
            setIsTouchScrubbing(true);
            setIsDragging(true);
            // Immediately seek to touch position
            const newTime = getTimeFromClientX(e.touches[0].clientX);
            if (newTime !== null) {
              setCurrentTime(newTime);
            }
          }}
        >
          {useSegmentedTimeline ? (
            // Segmented progress bar with chapters
            <div className={`w-full flex gap-[3px] ${isTouchScrubbing ? 'h-1.5' : 'h-1 group-hover:h-1.5'} transition-[height]`}>
              {timelineChapters.map((chapter, index) => {
                const chapterEnd = chapter.start + chapter.duration;
                // Calculate fill percentage for this segment
                let fillPercent = 0;
                if (currentTime >= chapterEnd) {
                  fillPercent = 100;
                } else if (currentTime > chapter.start) {
                  fillPercent = ((currentTime - chapter.start) / chapter.duration) * 100;
                }
                return (
                  <div
                    key={index}
                    data-testid="timeline-segment"
                    className="h-full bg-zinc-700 rounded-sm overflow-hidden relative"
                    style={{ flexGrow: chapter.duration }}
                    title={chapter.name}
                  >
                    <div
                      className="h-full"
                      style={{ background: "var(--accent)", width: `${fillPercent}%` }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            // Simple progress bar (no chapters or single chapter)
            <div className={`w-full bg-zinc-700 rounded-sm overflow-hidden ${isTouchScrubbing ? 'h-1.5' : 'h-1 group-hover:h-1.5'} transition-[height]`}>
              <div
                className="h-full"
                style={{ background: "var(--accent)", width: `${progress}%` }}
              />
            </div>
          )}
          {/* Progress dot - visible during playback, drag, or hover (like YouTube) */}
          <div
            data-testid="progress-handle"
            className={`absolute top-1/2 rounded-full -translate-y-1/2 transition-[transform] duration-100 ${isDragging || isTouchScrubbing || isPlaying ? 'scale-100' : 'scale-0 group-hover:scale-100'}`}
            style={{
              background: "var(--accent)",
              left: `calc(${progress}% - ${isTouchScrubbing ? 8 : 6}px)`,
              width: isTouchScrubbing ? 16 : 12,
              height: isTouchScrubbing ? 16 : 12,
              transition: 'width 0.15s, height 0.15s, left 0.05s',
            }}
          />
        </div>

        {/* Controls overlay */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-2 bg-gradient-to-t from-black/90 to-transparent z-20">
          {/* Play/Pause/Replay button - single button that switches */}
          <button
            data-testid="play-toggle"
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
            onClick={togglePlay}
          >
            {isEnded ? (
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
            ) : isPlaying ? (
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Time display */}
          <div className="text-sm text-white font-mono">
            <span data-testid="current-time">{formatTime(currentTime)}</span>
            <span className="text-zinc-400 mx-1">/</span>
            <span data-testid="duration-time">{formatTime(duration)}</span>
          </div>

          {!isMobile && (
            <div className="flex items-center gap-1.5 ml-3">
              {currentChapter && useSegmentedTimeline && (
                <>
                  <span className="text-zinc-500">•</span>
                  <span className="text-sm text-zinc-300 truncate max-w-[200px]" title={currentChapter.name}>
                    {currentChapter.name}
                  </span>
                </>
              )}
              <button
                data-testid="capture-frame-button"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-zinc-400 hover:text-white"
                onClick={() => captureFrameAndInsert((t) => (
                  currentChapter && useSegmentedTimeline
                    ? `[${formatTime(t)}] ${currentChapter.name}: `
                    : `[${formatTime(t)}]: `
                ))}
                title="Capture frame + timestamp to chat"
                aria-label="Capture frame and timestamp to chat"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
              </button>
            </div>
          )}

          <div className="flex-1" />

          {isMobile ? (
            /* Mobile: more button + fullscreen button */
            <div className="flex items-center gap-1">
              <button
                data-testid="capture-frame-button"
                className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors text-zinc-300 hover:text-white"
                onClick={() => captureFrameAndInsert((t) => (
                  currentChapter && useSegmentedTimeline
                    ? `[${formatTime(t)}] ${currentChapter.name}: `
                    : `[${formatTime(t)}]: `
                ))}
                title="Capture frame + timestamp to chat"
                aria-label="Capture frame and timestamp to chat"
              >
                <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 fill-current">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
              </button>
              <div className="relative">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${openMenu === 'more' ? 'bg-white/20' : 'hover:bg-white/10'}`}
                onClick={() => { setOpenMenu(openMenu === 'more' ? 'none' : 'more'); setOpenSubmenu('none'); }}
                title="More options"
                aria-label="More options"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                </svg>
              </button>
              {openMenu === 'more' && (
                <div className="absolute bottom-full right-0 mb-2 bg-zinc-800 rounded-lg shadow-lg min-w-[200px] z-20 overflow-hidden">
                  {/* Subtitles toggle */}
                  <button
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-3"
                    onClick={() => { setSubtitlesOn(!subtitlesOn); closeMenus(); }}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
                      <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/>
                    </svg>
                    <span>Subtitles</span>
                    <span className={`ml-auto text-xs ${subtitlesOn ? 'text-[var(--accent)]' : 'text-zinc-500'}`}>{subtitlesOn ? 'On' : 'Off'}</span>
                  </button>

                  <div className="h-px bg-zinc-700" />

                  {/* Subtitle size */}
                  <button
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-3"
                    onClick={() => { setOpenSubmenu(openSubmenu === 'size' ? 'none' : 'size'); }}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
                      <path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/>
                    </svg>
                    <span>Subtitle size</span>
                    <span className="ml-auto text-xs text-zinc-400">{subtitleSize.charAt(0).toUpperCase() + subtitleSize.slice(1)}</span>
                  </button>
                  {openSubmenu === 'size' && (
                    <div className="bg-zinc-700/50">
                      {(['small', 'medium', 'large'] as const).map((size) => (
                        <button
                          key={size}
                          className={`w-full px-4 py-2 pl-11 text-left text-sm hover:bg-zinc-700 ${subtitleSize === size ? 'text-[var(--accent)]' : 'text-zinc-300'}`}
                          onClick={() => { setSubtitleSize(size); closeMenus(); }}
                        >
                          {subtitleSize === size ? '✓ ' : '  '}{size.charAt(0).toUpperCase() + size.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="h-px bg-zinc-700" />

                  {/* Playback speed */}
                  <button
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-3"
                    onClick={() => { setOpenSubmenu(openSubmenu === 'speed' ? 'none' : 'speed'); }}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
                      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                    </svg>
                    <span>Speed</span>
                    <span className="ml-auto text-xs text-zinc-400">{playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}x`}</span>
                  </button>
                  {openSubmenu === 'speed' && (
                    <div className="bg-zinc-700/50">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                        <button
                          key={speed}
                          className={`w-full px-4 py-2 pl-11 text-left text-sm hover:bg-zinc-700 ${playbackSpeed === speed ? 'text-[var(--accent)]' : 'text-zinc-300'}`}
                          onClick={() => { changeSpeed(speed); closeMenus(); }}
                        >
                          {playbackSpeed === speed ? '✓ ' : '  '}{speed === 1 ? 'Normal' : `${speed}x`}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="h-px bg-zinc-700" />

                  {/* Download */}
                  <button
                    className="w-full px-4 py-3 text-left text-sm text-white hover:bg-zinc-700 flex items-center gap-3"
                    onClick={() => { setShowDownloadModal(true); closeMenus(); }}
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current flex-shrink-0">
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    <span>Download</span>
                  </button>
                </div>
              )}
              </div>
              {/* Fullscreen / expand button */}
              <button
                className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                onClick={toggleFullscreen}
                title="Fullscreen"
                aria-label="Fullscreen"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              </button>
            </div>
          ) : (
            /* Desktop: separate CC, Settings, Download buttons */
            <>
              {/* CC button */}
              <button
                className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${subtitlesOn ? 'bg-white/20' : 'hover:bg-white/10'}`}
                onClick={() => setSubtitlesOn(!subtitlesOn)}
                title="Subtitles (C)"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/>
                </svg>
              </button>

              {/* Settings button with gear icon */}
              <div className="relative">
                <button
                  className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${openMenu === 'settings' ? 'bg-white/20' : 'hover:bg-white/10'}`}
                  onClick={() => { setOpenMenu(openMenu === 'settings' ? 'none' : 'settings'); setOpenSubmenu('none'); }}
                  title="Settings"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                    <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                  </svg>
                </button>
                {openMenu === 'settings' && (
                  <div className="absolute bottom-full right-0 mb-2 bg-zinc-800 rounded-lg shadow-lg overflow-visible min-w-[180px] z-20">
                    {/* Subtitle size option */}
                    <div
                      className="px-4 py-2 text-sm text-white hover:bg-zinc-700 cursor-pointer flex items-center justify-between"
                      onMouseEnter={() => setOpenSubmenu('size')}
                    >
                      <span>Subtitle size</span>
                      <span className="text-zinc-400">›</span>
                    </div>
                    {openSubmenu === 'size' && (
                      <div
                        className="absolute right-full top-0 mr-1 bg-zinc-800 rounded-lg shadow-lg overflow-hidden min-w-[140px]"
                        onMouseLeave={() => setOpenSubmenu('none')}
                      >
                        {(['small', 'medium', 'large'] as const).map((size) => (
                          <button
                            key={size}
                            className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2 ${subtitleSize === size ? 'text-[var(--accent)]' : 'text-white'}`}
                            onClick={() => { setSubtitleSize(size); closeMenus(); }}
                          >
                            {subtitleSize === size && <span>✓</span>}
                            <span className={subtitleSize !== size ? 'ml-5' : ''}>{size.charAt(0).toUpperCase() + size.slice(1)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="h-px bg-zinc-700 my-1" />
                    {/* Playback speed option */}
                    <div
                      className="px-4 py-2 text-sm text-white hover:bg-zinc-700 cursor-pointer flex items-center justify-between"
                      onMouseEnter={() => setOpenSubmenu('speed')}
                    >
                      <span>Playback speed</span>
                      <span className="text-zinc-400">›</span>
                    </div>
                    {openSubmenu === 'speed' && (
                      <div
                        className="absolute right-full bottom-0 mr-1 bg-zinc-800 rounded-lg shadow-lg overflow-hidden min-w-[140px]"
                        onMouseLeave={() => setOpenSubmenu('none')}
                      >
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                          <button
                            key={speed}
                            className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2 ${playbackSpeed === speed ? 'text-[var(--accent)]' : 'text-white'}`}
                            onClick={() => changeSpeed(speed)}
                          >
                            {playbackSpeed === speed && <span>✓</span>}
                            <span className={playbackSpeed !== speed ? 'ml-5' : ''}>{speed === 1 ? 'Normal' : `${speed}x`}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Download button */}
              <button
                className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                onClick={() => setShowDownloadModal(true)}
                title="Download"
                data-testid="download-trigger"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
              </button>

              {/* Fullscreen button */}
              <button
                className="w-9 h-9 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                onClick={toggleFullscreen}
                title="Fullscreen (F)"
                aria-label="Fullscreen"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Download Modal */}
      {showDownloadModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={(e) => e.target === e.currentTarget && setShowDownloadModal(false)}
        >
          <div className="bg-zinc-800 rounded-xl p-6 min-w-[320px] max-w-[400px] shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-4">Download video</h3>

            {/* Quality selector */}
            <>
              <div className="space-y-2 mb-5">
                  {/* Current quality option */}
                  <div
                    className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer"
                    style={{
                      background: downloadQuality === 'current' ? "rgba(255,255,255,0.08)" : "transparent",
                      borderColor: downloadQuality === 'current' ? "var(--accent)" : "rgba(255,255,255,0.1)",
                    }}
                    onClick={() => setDownloadQuality('current')}
                    data-testid="download-quality-current"
                  >
                    <div className="w-5 h-5 border-2 rounded-full flex items-center justify-center" style={{ borderColor: downloadQuality === 'current' ? "var(--accent)" : "rgba(255,255,255,0.3)" }}>
                      {downloadQuality === 'current' && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">Current quality</div>
                      <div className="text-xs text-zinc-400">Instant download</div>
                    </div>
                  </div>
                  {/* HQ option */}
                  <div
                    className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer"
                    style={{
                      background: downloadQuality === 'hq' ? "rgba(255,255,255,0.08)" : "transparent",
                      borderColor: downloadQuality === 'hq' ? "var(--accent)" : "rgba(255,255,255,0.1)",
                    }}
                    onClick={() => setDownloadQuality('hq')}
                    data-testid="download-quality-hq"
                  >
                    <div className="w-5 h-5 border-2 rounded-full flex items-center justify-center" style={{ borderColor: downloadQuality === 'hq' ? "var(--accent)" : "rgba(255,255,255,0.3)" }}>
                      {downloadQuality === 'hq' && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">High quality (1080p, 30fps)</div>
                      <div className="text-xs text-zinc-400">Starts a new render, then downloads automatically</div>
                    </div>
                  </div>
                  {/* 4K option */}
                  <div
                    className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer"
                    style={{
                      background: downloadQuality === '4k' ? "rgba(255,255,255,0.08)" : "transparent",
                      borderColor: downloadQuality === '4k' ? "var(--accent)" : "rgba(255,255,255,0.1)",
                    }}
                    onClick={() => setDownloadQuality('4k')}
                    data-testid="download-quality-4k"
                  >
                    <div className="w-5 h-5 border-2 rounded-full flex items-center justify-center" style={{ borderColor: downloadQuality === '4k' ? "var(--accent)" : "rgba(255,255,255,0.3)" }}>
                      {downloadQuality === '4k' && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">4K (2160p, 30fps)</div>
                      <div className="text-xs text-zinc-400">Starts a new render, then downloads automatically</div>
                    </div>
                  </div>
              </div>
              {downloadQuality !== 'current' && (
                <div className="mb-4 text-xs text-zinc-400">
                  {isRendering
                    ? "Finish the current render before starting another."
                    : "The render will run in chat, and the new file will download automatically when ready."}
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  className="px-5 py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium transition-colors"
                  onClick={() => setShowDownloadModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                  style={{ background: "var(--accent)", color: "var(--text-primary)" }}
                  onMouseEnter={(e) => { if (!isDownloading) e.currentTarget.style.background = "var(--accent-hover)"; }}
                  onMouseLeave={(e) => e.currentTarget.style.background = "var(--accent)"}
                  onClick={handleDownload}
                  disabled={isDownloading || (downloadQuality !== 'current' && isRendering)}
                  data-testid="download-confirm"
                >
                  {isDownloading
                    ? "Downloading..."
                    : downloadQuality === 'current'
                      ? "Download"
                      : isRendering
                        ? "Render in progress"
                        : "Render & download"}
                </button>
              </div>
            </>
          </div>
        </div>
      )}

      {/* Close menus when clicking outside — z-[19] sits above mobile tap overlay (z-[11]) and progress bar (z-[15]) but below controls (z-20) */}
      {openMenu !== 'none' && (
        <div
          className="fixed inset-0 z-[19]"
          onClick={closeMenus}
        />
      )}

      {/* Animations for mobile interactions */}
      <style>{`
        @keyframes dtap-fade { 0% { opacity: 1; transform: translateY(-50%) scale(1); } 100% { opacity: 0; transform: translateY(-50%) scale(1.2); } }
      `}</style>
    </div>
  );
}
