/**
 * Shared types used across client and server
 */

// SSE event types from /api/chat
export interface SSEEvent {
  type: "progress" | "complete" | "error" | "tool_use" | "tool_result" | "assistant_text" | "system_init";
  state?: "planning" | "coding" | "rendering" | "complete" | "error";
  message: string;
  session_id?: string;
  sandbox_id?: string;
  claude_session_id?: string;
  video_url?: string;
  progress?: number;
  // Additional fields for detailed events
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
  is_error?: boolean;
  model?: string;
  tools?: string[];
  sandbox_source?: "new" | "existing" | "snapshot" | "mapping";
  // Token usage tracking
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  // Diagnostic metadata for tracing stalls/timeouts
  error_code?: string;
  timeout_minutes?: number;
  timeout_ms?: number;
  elapsed_ms?: number;
  command_started_at?: string;
  command_deadline_at?: string;
}

// Activity event for tracking Claude's actions
export interface ActivityEvent {
  id: string;
  timestamp: Date;
  type: "system_init" | "assistant_text" | "tool_use" | "tool_result" | "progress" | "error" | "complete";
  message: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
  model?: string;
  tools?: string[];
  sandboxSource?: "new" | "existing" | "snapshot" | "mapping";
  turnId?: string; // ID of the user message that triggered this activity
  errorCode?: string;
  timeoutMinutes?: number;
  timeoutMs?: number;
  elapsedMs?: number;
  commandStartedAt?: string;
  commandDeadlineAt?: string;
}

// Activity event from database (Manus Pattern: Persisted Activity Stream)
export interface DBActivityEvent {
  id: number;
  run_id: string;
  turn_id: string | null;
  type: "system_init" | "assistant_text" | "tool_use" | "tool_result" | "progress" | "error" | "complete";
  message: string | null;
  payload: {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_result?: string;
    is_error?: boolean;
    model?: string;
    tools?: string[];
    video_url?: string;
    sandbox_source?: "new" | "existing" | "snapshot" | "mapping";
    error_code?: string;
    timeout_minutes?: number;
    timeout_ms?: number;
    elapsed_ms?: number;
    command_started_at?: string;
    command_deadline_at?: string;
  } | null;
  created_at: string;
}

// Active run info from database
export interface ActiveRun {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  started_at: string | null;
  last_event_at: string | null;
  sandbox_id: string | null;
  claude_session_id: string | null;
}

/**
 * Convert database activity event to UI activity event
 */
export function dbActivityEventToUI(dbEvent: DBActivityEvent): ActivityEvent {
  return {
    id: String(dbEvent.id),
    timestamp: new Date(dbEvent.created_at),
    type: dbEvent.type,
    message: dbEvent.message || "",
    toolName: dbEvent.payload?.tool_name,
    toolInput: dbEvent.payload?.tool_input,
    toolResult: dbEvent.payload?.tool_result,
    isError: dbEvent.payload?.is_error,
    model: dbEvent.payload?.model,
    tools: dbEvent.payload?.tools,
    sandboxSource: dbEvent.payload?.sandbox_source,
    errorCode: dbEvent.payload?.error_code,
    timeoutMinutes: dbEvent.payload?.timeout_minutes,
    timeoutMs: dbEvent.payload?.timeout_ms,
    elapsedMs: dbEvent.payload?.elapsed_ms,
    commandStartedAt: dbEvent.payload?.command_started_at,
    commandDeadlineAt: dbEvent.payload?.command_deadline_at,
    turnId: dbEvent.turn_id || undefined,
  };
}

// Image attachment for chat messages
export interface ImageAttachment {
  id: string;
  path: string;      // Local filesystem path
  name: string;      // Original filename
  size: number;
  type: string;      // MIME type
  url?: string;      // API URL (display) or blob URL (local preview)
}

// Chat message
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  images?: ImageAttachment[];
}

// HQ render progress tracking
export interface HqRenderProgress {
  completed: number;
  total: number;
  current_scene: string;
  error?: string;
  /** Local file URL exposed by `/api/files` */
  hq_video_url?: string;
}

// Session data stored in sessionStorage (per-tab isolation)
export interface SessionData {
  sandboxId: string;
  claudeSessionId: string;
}
