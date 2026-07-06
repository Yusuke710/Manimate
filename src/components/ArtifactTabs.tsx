"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

// Shared placeholder component
export function Placeholder({ message, testId, icon }: { message: string; testId?: string; icon?: "document" | "code" | "video" }) {
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

export const PlanTab = memo(function PlanTab({
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

export const CodeTab = memo(function CodeTab({
  content,
}: {
  content: string | null;
}) {
  const { segments, lineCount } = useMemo(() => {
    if (!content) return { segments: [] as CodeSegment[], lineCount: 0 };
    return buildCodeSegments(content);
  }, [content]);
  const [copied, setCopied] = useState(false);
  const [copiedSceneId, setCopiedSceneId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    if (sceneCopyTimerRef.current) clearTimeout(sceneCopyTimerRef.current);
  }, []);

  const handleCopy = () => {
    if (!content || !navigator.clipboard) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const handleCopyScene = (scene: SceneCodeBlock) => {
    if (!navigator.clipboard) return;
    if (sceneCopyTimerRef.current) clearTimeout(sceneCopyTimerRef.current);
    navigator.clipboard.writeText(scene.content).then(() => {
      setCopiedSceneId(scene.id);
      sceneCopyTimerRef.current = setTimeout(() => setCopiedSceneId(null), 1500);
    }).catch(() => {});
  };

  const renderCodeLine = (line: HighlightedCodeLine) => (
    <div className="code-line" key={line.number}>
      <span className="line-number">{line.number}</span>
      <span className="line-content" dangerouslySetInnerHTML={{ __html: line.html || " " }} />
    </div>
  );

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
        <code>
          {segments.map((segment) => {
            if (segment.type === "scene") {
              const isCopied = copiedSceneId === segment.scene.id;
              return (
                <div
                  className="scene-code-block"
                  key={segment.scene.id}
                  data-testid="scene-code-block"
                  data-scene-name={segment.scene.name}
                >
                  <button
                    type="button"
                    className="scene-copy-btn"
                    onClick={() => handleCopyScene(segment.scene)}
                    aria-label={isCopied ? `Copied ${segment.scene.name}` : `Copy class ${segment.scene.name}`}
                    data-copied={isCopied || undefined}
                  >
                    {isCopied ? (
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
                        <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
                        <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
                      </svg>
                    )}
                    <span>{isCopied ? "Copied" : "Copy class"}</span>
                  </button>
                  {segment.scene.lines.map(renderCodeLine)}
                </div>
              );
            }

            return segment.lines.map(renderCodeLine);
          })}
        </code>
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
          padding: 10px 8px 16px;
          background: #111113;
          font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 13px;
          line-height: 1.6;
          flex: 1;
        }
        code {
          display: block;
        }
        .scene-code-block {
          position: relative;
          margin: 5px 0;
          padding: 4px 0;
          border: 1px solid transparent;
          border-radius: 8px;
          background: linear-gradient(90deg, rgba(255,255,255,0.018), rgba(255,255,255,0.006));
          transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .scene-code-block::before {
          content: "";
          position: absolute;
          top: 8px;
          bottom: 8px;
          left: 0;
          width: 3px;
          border-radius: 999px;
          background: rgba(78,201,176,0.18);
          transition: background 0.18s ease, box-shadow 0.18s ease;
        }
        .scene-code-block:hover {
          background:
            linear-gradient(90deg, rgba(78,201,176,0.105), rgba(59,130,246,0.035) 42%, rgba(255,255,255,0.012)),
            rgba(255,255,255,0.012);
          border-color: rgba(78,201,176,0.26);
          box-shadow:
            0 10px 28px rgba(0,0,0,0.18),
            inset 0 1px 0 rgba(255,255,255,0.035);
        }
        .scene-code-block:hover::before {
          background: #4ec9b0;
          box-shadow: 0 0 14px rgba(78,201,176,0.42);
        }
        .scene-copy-btn {
          position: absolute;
          top: 7px;
          right: 10px;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 26px;
          padding: 0 9px;
          background: rgba(18,18,20,0.92);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          color: #c4c4cc;
          cursor: pointer;
          font-size: 11px;
          font-weight: 500;
          line-height: 1;
          opacity: 0;
          pointer-events: none;
          box-shadow: 0 8px 22px rgba(0,0,0,0.28);
          transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .scene-code-block:hover .scene-copy-btn,
        .scene-copy-btn:focus-visible {
          opacity: 1;
          pointer-events: auto;
        }
        .scene-copy-btn:hover {
          background: rgba(31,31,35,0.98);
          border-color: rgba(78,201,176,0.32);
          color: #f8fafc;
          transform: translateY(-1px);
        }
        .scene-copy-btn[data-copied] {
          color: var(--accent);
          border-color: color-mix(in srgb, var(--accent) 35%, transparent);
        }
        pre :global(.code-line) {
          display: flex;
        }
        pre :global(.code-line:hover) {
          background: rgba(255,255,255,0.03);
        }
        .scene-code-block :global(.code-line:hover) {
          background: transparent;
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
        .scene-code-block :global(.line-content) {
          padding-right: 132px;
        }
        pre :global(.hl-keyword) { color: #c586c0; }
        pre :global(.hl-string) { color: #ce9178; }
        pre :global(.hl-comment) { color: #6a9955; }
        pre :global(.hl-function) { color: #dcdcaa; }
        pre :global(.hl-class) { color: #4ec9b0; }
        pre :global(.hl-number) { color: #b5cea8; }
        pre :global(.hl-decorator) { color: #d7ba7d; }
        pre :global(.hl-builtin) { color: #4fc1ff; }
        @media (hover: none) {
          .scene-copy-btn {
            opacity: 0.9;
            pointer-events: auto;
          }
        }
      `}</style>
    </div>
  );
});

interface HighlightedCodeLine {
  number: number;
  html: string;
}

interface SceneCodeBlock {
  id: string;
  name: string;
  content: string;
  lines: HighlightedCodeLine[];
}

type CodeSegment =
  | { type: "lines"; lines: HighlightedCodeLine[] }
  | { type: "scene"; scene: SceneCodeBlock };

const PYTHON_KEYWORDS = new Set([
  "def", "class", "if", "elif", "else", "for", "while", "try", "except", "finally",
  "with", "as", "import", "from", "return", "yield", "raise", "pass", "break",
  "continue", "and", "or", "not", "in", "is", "lambda", "True", "False", "None",
  "self", "async", "await",
]);

const PYTHON_BUILTINS = new Set([
  "print", "range", "len", "str", "int", "float", "list", "dict", "set", "tuple",
  "super", "isinstance", "type", "open", "enumerate", "zip", "map", "filter",
  "sorted", "reversed", "min", "max", "sum", "abs", "any", "all",
]);

const SCENE_CLASS_PATTERN = /^(\s*)class\s+([A-Za-z_]\w*)\s*\(([^)]*Scene[^)]*)\)\s*:/;

function buildCodeSegments(code: string): { segments: CodeSegment[]; lineCount: number } {
  const lines = code.split('\n');
  const highlightedLines = lines.map((line, index) => ({
    number: index + 1,
    html: highlightPythonLine(line),
  }));
  const sceneRanges = findSceneClassRanges(lines);
  const segments: CodeSegment[] = [];
  let cursor = 0;

  for (const range of sceneRanges) {
    if (cursor < range.start) {
      segments.push({ type: "lines", lines: highlightedLines.slice(cursor, range.start) });
    }

    segments.push({
      type: "scene",
      scene: {
        id: `${range.name}-${range.start + 1}`,
        name: range.name,
        content: lines.slice(range.start, range.end + 1).join('\n'),
        lines: highlightedLines.slice(range.start, range.end + 1),
      },
    });
    cursor = range.end + 1;
  }

  if (cursor < lines.length) {
    segments.push({ type: "lines", lines: highlightedLines.slice(cursor) });
  }

  return { segments, lineCount: lines.length };
}

function findSceneClassRanges(lines: string[]): Array<{ start: number; end: number; name: string }> {
  const ranges: Array<{ start: number; end: number; name: string }> = [];
  let index = 0;

  while (index < lines.length) {
    const match = lines[index].match(SCENE_CLASS_PATTERN);
    if (!match) {
      index += 1;
      continue;
    }

    const classIndent = match[1].length;
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith("@")) {
      start -= 1;
    }

    let end = lines.length - 1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const line = lines[scan];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= classIndent) {
        end = scan - 1;
        while (end > index && !lines[end].trim()) end -= 1;
        break;
      }
    }

    ranges.push({ start, end, name: match[2] });
    index = end + 1;
  }

  return ranges;
}

function highlightPythonLine(line: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
      if (PYTHON_KEYWORDS.has(word)) result += `<span class="hl-keyword">${esc(word)}</span>`;
      else if (PYTHON_BUILTINS.has(word) && nextChar === '(') result += `<span class="hl-builtin">${esc(word)}</span>`;
      else if (i >= 4 && line.slice(i - 4, i) === 'def ') result += `<span class="hl-function">${esc(word)}</span>`;
      else if (i >= 6 && line.slice(i - 6, i) === 'class ') result += `<span class="hl-class">${esc(word)}</span>`;
      else result += esc(word);
      i = j;
    } else {
      result += esc(line[i]);
      i++;
    }
  }

  return result;
}

// Format time helper
