"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ActivityEvent, Message } from "@/lib/types";
import { getModelDisplayLabel } from "@/lib/models";
import ImageLightbox from "@/components/ImageLightbox";

// Unified timeline item
type TimelineItem =
  | { type: "message"; data: Message }
  | { type: "activity"; data: ActivityEvent };

interface ChatMessagesProps {
  messages: Message[];
  activityEvents?: ActivityEvent[];
  isLoading?: boolean;
  isLoadingMessages?: boolean;
}

interface LightboxImage {
  url: string;
  name: string;
}

interface LightboxState {
  images: LightboxImage[];
  index: number;
}

// Merge messages and activities into a unified chronological timeline
function buildTimeline(messages: Message[], activities: ActivityEvent[]): TimelineItem[] {
  const assistantMessageContents = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      assistantMessageContents.add(msg.content.trim().slice(0, 200));
    }
  }

  const filteredActivities = activities.filter(a => {
    if (a.type === "progress" || a.type === "complete") return false;
    if (a.type === "assistant_text") {
      const normalized = a.message.trim().slice(0, 200);
      if (assistantMessageContents.has(normalized)) return false;
    }
    return true;
  });

  // Group activities by turnId
  const activitiesByTurn = new Map<string, ActivityEvent[]>();
  for (const activity of filteredActivities) {
    const turnId = activity.turnId || "__orphan__";
    if (!activitiesByTurn.has(turnId)) {
      activitiesByTurn.set(turnId, []);
    }
    activitiesByTurn.get(turnId)!.push(activity);
  }

  for (const turnActivities of activitiesByTurn.values()) {
    turnActivities.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  const timeline: TimelineItem[] = [];
  const usedTurnIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "user") {
      timeline.push({ type: "message", data: message });

      const turnActivities = activitiesByTurn.get(message.id) || [];
      usedTurnIds.add(message.id);

      for (const activity of turnActivities) {
        if (activity.type === "assistant_text") {
          timeline.push({
            type: "message",
            data: { id: activity.id, role: "assistant" as const, content: activity.message },
          });
        } else {
          timeline.push({ type: "activity", data: activity });
        }
      }
    } else {
      timeline.push({ type: "message", data: message });
    }
  }

  // Add orphaned activities
  for (const [turnId, turnActivities] of activitiesByTurn) {
    if (!usedTurnIds.has(turnId)) {
      for (const activity of turnActivities) {
        if (activity.type === "assistant_text") {
          timeline.push({
            type: "message",
            data: { id: activity.id, role: "assistant" as const, content: activity.message },
          });
        } else {
          timeline.push({ type: "activity", data: activity });
        }
      }
    }
  }

  return timeline;
}

// Group consecutive activity items for Manus-style display
interface ActivityGroup {
  events: ActivityEvent[];
  isComplete: boolean;
}

function groupActivities(timeline: TimelineItem[]): (TimelineItem | { type: "activity_group"; data: ActivityGroup })[] {
  const result: (TimelineItem | { type: "activity_group"; data: ActivityGroup })[] = [];
  let currentGroup: ActivityEvent[] = [];

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      const allDone = currentGroup.every(e =>
        e.type === "tool_result" || e.type === "system_init"
      );
      result.push({ type: "activity_group", data: { events: [...currentGroup], isComplete: allDone } });
      currentGroup = [];
    }
  };

  for (const item of timeline) {
    if (item.type === "activity") {
      currentGroup.push(item.data as ActivityEvent);
    } else {
      flushGroup();
      result.push(item);
    }
  }
  flushGroup();

  return result;
}

export default function ChatMessages({
  messages,
  activityEvents = [],
  isLoading = false,
  isLoadingMessages = false,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const timeline = buildTimeline(messages, activityEvents);
  const grouped = groupActivities(timeline);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Only auto-scroll if user is near the bottom
  useEffect(() => {
    if (isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [grouped.length, isLoading]);

  if (isLoadingMessages) {
    return (
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 24, height: 24,
            borderRadius: "50%",
            border: "2px solid var(--border-input)",
            borderTopColor: "var(--text-tertiary)",
            animation: "spin 1s linear infinite",
          }} />
          <p style={{ fontSize: 16, color: "var(--text-tertiary)" }}>Loading messages...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0 && activityEvents.length === 0) {
    return (
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <p style={{ color: "var(--text-tertiary)", fontSize: 16 }}>Messages will appear here</p>
      </div>
    );
  }

  return (
    <div onScroll={handleScroll} data-testid="chat-messages" style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {grouped.map((item, index) => {
        if (item.type === "message") {
          return (
            <MessageRow
              key={`msg-${item.data.id}`}
              message={item.data}
              onImageClick={(images, imageIndex) => setLightbox({ images, index: imageIndex })}
            />
          );
        } else if (item.type === "activity_group") {
          return <ActivityGroupCard key={`grp-${index}`} group={item.data} />;
        } else {
          return <ActivityPill key={`act-${(item.data as ActivityEvent).id}-${index}`} event={item.data as ActivityEvent} />;
        }
      })}
      {isLoading && <LoadingIndicator />}
      <div ref={bottomRef} />
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(nextIndex) => setLightbox((prev) => (prev ? { ...prev, index: nextIndex } : prev))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function MessageRow({ message, onImageClick }: { message: Message; onImageClick: (images: LightboxImage[], index: number) => void }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div
        data-testid="message-user"
        style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end",
          padding: "12px 20px",
        }}
      >
        {/* Image thumbnails */}
        {message.images && message.images.length > 0 && (
          <ImageGrid images={message.images} onImageClick={onImageClick} />
        )}
        {/* User bubble */}
        <div style={{
          background: "var(--bg-white)",
          borderRadius: "12px 12px 0 12px",
          padding: 12,
          maxWidth: "90%",
          fontSize: 17, lineHeight: 1.65, color: "var(--text-primary)",
        }}>
          {message.content ? <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="message-assistant"
      style={{ padding: "16px 20px" }}
    >
      {/* Manimate label */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 400, fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif", color: "var(--accent)" }}>∑</span>
          <span style={{ fontSize: 17, fontWeight: 400, fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>Manimate</span>
        </span>
      </div>

      {/* Error indicator */}
      {message.isError && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
          color: "var(--red)", fontSize: 15, fontWeight: 600,
        }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          Error
        </div>
      )}

      {/* Message content */}
      <div style={{ fontSize: 17, lineHeight: 1.65, color: "var(--text-primary)" }}>
        <div className="prose prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:my-2" style={{ color: "var(--text-primary)" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// Collapsible activity group
function ActivityGroupCard({ group }: { group: ActivityGroup }) {
  const [expanded, setExpanded] = useState(true);
  const rest = group.events.slice(1);
  const restCount = rest.length;

  return (
    <div style={{ padding: "8px 20px 12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {/* First pill + toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ActivityPill event={group.events[0]} />
          {restCount > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                background: "none", border: "none", cursor: "pointer",
                padding: "2px 4px", borderRadius: 4,
                fontSize: 12, color: "var(--text-tertiary)",
                fontFamily: "var(--font)",
                whiteSpace: "nowrap",
              }}
              title={expanded ? "Collapse" : "Expand"}
            >
              {!expanded && <span>+{restCount}</span>}
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
                style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
        {/* Remaining pills */}
        {expanded && rest.map((event, i) => (
          <ActivityPill key={`${event.id}-${i}`} event={event} />
        ))}
      </div>
    </div>
  );
}


// Tool-specific SVG icons (14x14)
function PillIcon({ event }: { event: ActivityEvent }) {
  const color = "currentColor";
  const size = 14;

  // System init → rocket
  if (event.type === "system_init") return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path d="M4.75 8.75a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5a.75.75 0 01.75-.75zM6 11v-1.25l-1.25.75L6 11zm10.75-2.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5zM14 11l1.25-.5L14 9.75V11zm-4-9.5a.75.75 0 01.69.46l1.76 4.17 1.09-.56a.75.75 0 011.09.55l.5 4.5a.75.75 0 01-.44.78l-2.1.88v3.47a.75.75 0 01-.46.69l-1.5.64a.75.75 0 01-.58 0l-1.5-.64a.75.75 0 01-.46-.69v-3.47l-2.1-.88a.75.75 0 01-.44-.78l.5-4.5a.75.75 0 011.09-.55l1.09.56 1.76-4.17A.75.75 0 0110 1.5z" /></svg>
  );

  // Tool-specific icons
  if (event.type === "tool_use" || event.type === "tool_result") {
    const tool = event.toolName || "";

    // Bash → terminal
    if (tool === "Bash") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 001 5.25v9.5A2.25 2.25 0 003.25 17h13.5A2.25 2.25 0 0019 14.75v-9.5A2.25 2.25 0 0016.75 3H3.25zM2.5 5.25a.75.75 0 01.75-.75h13.5a.75.75 0 01.75.75v9.5a.75.75 0 01-.75.75H3.25a.75.75 0 01-.75-.75v-9.5zM5.22 7.47a.75.75 0 011.06 0l2.25 2.25a.75.75 0 010 1.06l-2.25 2.25a.75.75 0 01-1.06-1.06L6.94 10.25 5.22 8.53a.75.75 0 010-1.06zM10 12.25a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" clipRule="evenodd" /></svg>
    );

    // Read → eye
    if (tool === "Read") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /><path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
    );

    // Write → pencil-square
    if (tool === "Write") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg>
    );

    // Edit → pencil
    if (tool === "Edit") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" /></svg>
    );

    // Grep/Glob → magnifying glass
    if (tool === "Grep" || tool === "Glob") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" /></svg>
    );

    // WebFetch/WebSearch → globe
    if (tool === "WebFetch" || tool === "WebSearch") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-1.503.204A6.5 6.5 0 117.95 3.83L6.927 6.422A1.75 1.75 0 006.743 8.5H4.25a.75.75 0 00-.75.75v1.5c0 .414.336.75.75.75h1.374a1.75 1.75 0 011.673 1.239l.346 1.133A6.474 6.474 0 0010 16.5a6.48 6.48 0 004.763-2.084l-.36-.325A1.75 1.75 0 0113.225 12h-.94a.75.75 0 01-.748-.688l-.173-2.074a1.75 1.75 0 011.057-1.748l2.076-.876z" clipRule="evenodd" /></svg>
    );

    // TodoWrite → bullet list
    if (tool === "TodoWrite") return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path d="M3 4a1.25 1.25 0 112.5 0A1.25 1.25 0 013 4zm4.5-.75h9a.75.75 0 010 1.5h-9a.75.75 0 010-1.5zM3 10a1.25 1.25 0 112.5 0A1.25 1.25 0 013 10zm4.5-.75h9a.75.75 0 010 1.5h-9a.75.75 0 010-1.5zM3 16a1.25 1.25 0 112.5 0A1.25 1.25 0 013 16zm4.5-.75h9a.75.75 0 010 1.5h-9a.75.75 0 010-1.5z"/></svg>
    );

    // Default tool → wrench
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path fillRule="evenodd" d="M13.488 2.513a1.75 1.75 0 00-2.55.138l-1.093 1.312a1.75 1.75 0 00-.376 1.372l.217 1.302-4.262 4.262a1.75 1.75 0 000 2.474l.707.708a1.75 1.75 0 002.474 0l4.262-4.262 1.302.217a1.75 1.75 0 001.372-.376l1.312-1.093a1.75 1.75 0 00.138-2.55l-3.503-3.503z" clipRule="evenodd" /></svg>
    );
  }

  // Error → exclamation
  if (event.type === "error") return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
  );

  // Default → info circle
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill={color}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
  );
}

// Manus-style step pill
function getToolResultText(event: ActivityEvent): string {
  if (event.type !== "tool_result") return event.message;
  if (typeof event.toolResult === "string" && event.toolResult.trim().length > 0) {
    return event.toolResult;
  }
  return event.message;
}

function ActivityPill({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const summary = getCompactSummary(event);
  const isDone = event.type === "tool_result" || event.type === "system_init";
  const isError = event.type === "error" || (event.type === "tool_result" && event.isError);
  const hasExpandable =
    (event.type === "tool_use" && event.toolInput) ||
    (event.type === "tool_result" && getToolResultText(event).length > 80) ||
    event.type === "system_init" ||
    event.type === "error";

  return (
    <div>
      <button
        onClick={() => hasExpandable && setExpanded(!expanded)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-light)",
          borderRadius: 20,
          fontSize: 13,
          color: isError ? "var(--red)" : "var(--text-secondary)",
          width: "fit-content",
          maxWidth: "100%",
          cursor: hasExpandable ? "pointer" : "default",
          fontFamily: "var(--font)",
          textAlign: "left",
        }}
      >
        <span style={{
          flexShrink: 0,
          width: 14, height: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: isError ? "var(--red)" : isDone ? "var(--green)" : "var(--text-tertiary)",
        }}>
          {isError ? (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
          ) : isDone ? (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
          ) : (
            <PillIcon event={event} />
          )}
        </span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {summary}
        </span>
      </button>

      {expanded && hasExpandable && (
        <div style={{ marginTop: 4, marginLeft: 22, padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
          <ExpandedContent event={event} />
        </div>
      )}
    </div>
  );
}

function getCompactSummary(event: ActivityEvent): string {
  if (event.type === "tool_use" && event.toolInput) {
    const { toolInput, toolName } = event;
    if (toolName === "Bash" && toolInput.command) {
      const cmd = String(toolInput.command);
      return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
    }
    if (["Write", "Read", "Edit"].includes(toolName || "") && toolInput.file_path) {
      const action = toolName === "Write" ? "Writing" : toolName === "Read" ? "Reading" : "Editing";
      return `${action} ${String(toolInput.file_path)}`;
    }
    if (toolName === "TodoWrite") {
      const todos = Array.isArray(toolInput.todos) ? toolInput.todos : [];
      if (todos.length > 0) return `Planning ${todos.length} task${todos.length === 1 ? "" : "s"}`;
      return "Updating task plan";
    }
  }
  if (event.type === "tool_result" || event.type === "assistant_text") {
    const maxLen = event.type === "tool_result" ? 80 : 100;
    const text = event.type === "tool_result" ? getToolResultText(event) : event.message;
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
  return event.message;
}

function formatDurationCompact(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

function ExpandedContent({ event }: { event: ActivityEvent }) {
  switch (event.type) {
    case "system_init":
      return (
        <div>
          {event.model && <div>Model: <strong>{getModelDisplayLabel(event.model)}</strong></div>}
          {event.tools && event.tools.length > 0 && (
            <div>Tools: {event.tools.slice(0, 10).join(", ")}{event.tools.length > 10 && ` +${event.tools.length - 10} more`}</div>
          )}
          {event.timeoutMinutes !== undefined && (
            <div>Command timeout: <strong>{event.timeoutMinutes}m</strong></div>
          )}
          {event.commandStartedAt && <div>Started: {event.commandStartedAt}</div>}
          {event.commandDeadlineAt && <div>Deadline: {event.commandDeadlineAt}</div>}
        </div>
      );
    case "tool_use":
      return <ToolInputDetail input={event.toolInput} toolName={event.toolName} />;
    case "tool_result":
      return (
        <pre style={{ maxHeight: 192, overflow: "auto", whiteSpace: "pre-wrap", background: "#1f2937", color: "#d4d4d4", padding: 8, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
          {getToolResultText(event)}
        </pre>
      );
    case "error":
      return (
        <div style={{ color: "var(--red)" }}>
          <div>{event.message}</div>
          {event.errorCode && (
            <div style={{ marginTop: 4, color: "var(--text-secondary)" }}>
              Code: <strong>{event.errorCode}</strong>
            </div>
          )}
          {event.timeoutMinutes !== undefined && (
            <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>
              Timeout: {event.timeoutMinutes}m
              {event.timeoutMs !== undefined ? ` (${Math.round(event.timeoutMs / 1000)}s)` : ""}
            </div>
          )}
          {event.elapsedMs !== undefined && (
            <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>
              Elapsed: {formatDurationCompact(event.elapsedMs)}
            </div>
          )}
          {event.commandStartedAt && (
            <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>
              Started: {event.commandStartedAt}
            </div>
          )}
          {event.commandDeadlineAt && (
            <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>
              Deadline: {event.commandDeadlineAt}
            </div>
          )}
        </div>
      );
    default:
      return null;
  }
}

function ToolInputDetail({ input, toolName }: { input?: Record<string, unknown>; toolName?: string }) {
  if (!input) return null;

  if (toolName === "Bash" && input.command) {
    return (
      <div>
        <pre style={{ overflow: "auto", background: "#1f2937", color: "#86efac", padding: 8, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
          $ {String(input.command)}
        </pre>
        {input.description ? <div style={{ marginTop: 4, fontStyle: "italic", color: "var(--text-tertiary)" }}>{String(input.description)}</div> : null}
      </div>
    );
  }

  if ((toolName === "Write" || toolName === "Read" || toolName === "Edit") && input.file_path) {
    return (
      <div>
        <div>Path: <strong style={{ color: "var(--yellow)" }}>{String(input.file_path)}</strong></div>
        {toolName === "Edit" && input.old_string && input.new_string ? (
          <pre style={{ marginTop: 4, background: "#1f2937", padding: 8, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
            <div style={{ color: "#fca5a5" }}>- {String(input.old_string).slice(0, 100)}</div>
            <div style={{ color: "#86efac" }}>+ {String(input.new_string).slice(0, 100)}</div>
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <pre style={{ maxHeight: 128, overflow: "auto", background: "#1f2937", color: "#9ca3af", padding: 8, borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

/** Collapsible image grid — shows up to 6 inline, rest behind "+N" toggle */
function ImageGrid({
  images,
  onImageClick,
}: {
  images: { id: string; url?: string; name: string }[];
  onImageClick: (images: LightboxImage[], index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = images.filter((img): img is typeof img & { url: string } => !!img.url);
  if (visible.length === 0) return null;
  const lightboxImages = visible.map((img) => ({ url: img.url, name: img.name }));

  const hasOverflow = visible.length > 6;
  const shown = hasOverflow && !expanded ? visible.slice(0, 5) : visible;
  const hidden = visible.length - shown.length;
  const sz = hasOverflow ? 48 : 64;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8, justifyContent: "flex-end" }}>
      {shown.map((img) => (
        <button
          key={img.id}
          onClick={() => onImageClick(lightboxImages, visible.findIndex((candidate) => candidate.id === img.id))}
          style={{ padding: 0, border: "none", background: "none", cursor: "pointer", lineHeight: 0 }}
          aria-label={`View ${img.name}`}
        >
          <img src={img.url} alt={img.name} style={{ height: sz, width: sz, borderRadius: 4, objectFit: "cover", border: "1px solid var(--border-light)" }} />
        </button>
      ))}
      {hasOverflow && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: sz, height: sz, borderRadius: 4,
            border: "1px solid var(--border-light)", background: "var(--bg-card)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 600, color: "var(--text-secondary)",
            fontFamily: "var(--font)",
          }}
        >
          {expanded ? "less" : `+${hidden}`}
        </button>
      )}
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div data-testid="loading-indicator" style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 20px", color: "var(--text-tertiary)", fontSize: 16 }}>
      <div style={{ display: "flex", gap: 3 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-tertiary)", animation: "blink 1.4s infinite" }} />
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-tertiary)", animation: "blink 1.4s infinite", animationDelay: "0.2s" }} />
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-tertiary)", animation: "blink 1.4s infinite", animationDelay: "0.4s" }} />
      </div>
      Working...
    </div>
  );
}
