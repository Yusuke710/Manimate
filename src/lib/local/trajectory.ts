import fs from "node:fs";
import path from "node:path";
import { getLocalSessionPaths } from "@/lib/local/config";

/**
 * Rebuilds a display-friendly agent trajectory from the verbatim CLI
 * transcripts archived in <session>/transcripts/<run>.jsonl.
 *
 * This is a read-only, best-effort view over the Claude Code / Codex native
 * formats: unknown line shapes are skipped, text is truncated, and parses are
 * cached — transcripts are written once at run end and never change, so a
 * (path, size) key is sufficient. Nothing here is a second store of events;
 * the JSONL stays the single source of truth.
 */

export interface TrajectoryEvent {
  id: number;
  run_id: string;
  turn_id: string | null;
  type: "assistant_text" | "tool_use" | "tool_result";
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const TEXT_MAX_CHARS = 6000;
const MESSAGE_MAX_CHARS = 280;
const MAX_EVENTS_PER_RUN = 1000;

type CacheEntry = { size: number; events: Omit<TrajectoryEvent, "id" | "turn_id">[] };
const cacheHost = globalThis as typeof globalThis & {
  __manimateTrajectoryCache?: Map<string, CacheEntry>;
};
const trajectoryCache: Map<string, CacheEntry> = (cacheHost.__manimateTrajectoryCache ??= new Map());

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…(truncated)`;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content) ?? "";
  } catch {
    return "";
  }
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { input: value };
  } catch {
    return { input: value };
  }
}

type RawEvent = Omit<TrajectoryEvent, "id" | "turn_id">;

function eventBase(runId: string, createdAt: string): Pick<RawEvent, "run_id" | "created_at"> {
  return { run_id: runId, created_at: createdAt };
}

/** Claude Code transcript lines: {type:"assistant"|"user", message:{content:[blocks]}, timestamp} */
function parseClaudeLine(obj: Record<string, unknown>, runId: string, fallbackTime: string): RawEvent[] {
  const message = obj.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const createdAt = typeof obj.timestamp === "string" ? obj.timestamp : fallbackTime;

  const events: RawEvent[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (obj.type === "assistant" && b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      events.push({
        ...eventBase(runId, createdAt),
        type: "assistant_text",
        message: truncate(b.text, TEXT_MAX_CHARS),
        payload: null,
      });
    }
    if (obj.type === "assistant" && b.type === "tool_use") {
      const toolName = typeof b.name === "string" ? b.name : "Tool";
      events.push({
        ...eventBase(runId, createdAt),
        type: "tool_use",
        message: toolName,
        payload: { tool_name: toolName, tool_input: parseToolInput(b.input) },
      });
    }
    if (obj.type === "user" && b.type === "tool_result") {
      const result = truncate(
        stringifyContent((b as { content?: unknown }).content).trim() || "Tool completed with no text output.",
        TEXT_MAX_CHARS
      );
      events.push({
        ...eventBase(runId, createdAt),
        type: "tool_result",
        message: truncate(result, MESSAGE_MAX_CHARS),
        payload: { tool_result: result, is_error: Boolean(b.is_error) },
      });
    }
  }
  return events;
}

/** Codex rollout lines: {type:"response_item", payload:{type, ...}, timestamp} */
function parseCodexLine(obj: Record<string, unknown>, runId: string, fallbackTime: string): RawEvent[] {
  if (obj.type !== "response_item") return [];
  const payload = obj.payload;
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const createdAt = typeof obj.timestamp === "string" ? obj.timestamp : fallbackTime;

  if (p.type === "message" && p.role === "assistant") {
    const text = stringifyContent(p.content).trim();
    if (!text) return [];
    return [{
      ...eventBase(runId, createdAt),
      type: "assistant_text",
      message: truncate(text, TEXT_MAX_CHARS),
      payload: null,
    }];
  }

  if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
    const toolName = typeof p.name === "string" && p.name ? p.name : "Bash";
    return [{
      ...eventBase(runId, createdAt),
      type: "tool_use",
      message: toolName,
      payload: { tool_name: toolName, tool_input: parseToolInput(p.arguments ?? p.input ?? p.action) },
    }];
  }

  if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
    const result = truncate(
      stringifyContent(p.output).trim() || "Tool completed with no text output.",
      TEXT_MAX_CHARS
    );
    return [{
      ...eventBase(runId, createdAt),
      type: "tool_result",
      message: truncate(result, MESSAGE_MAX_CHARS),
      payload: { tool_result: result, is_error: false },
    }];
  }

  return [];
}

function parseTranscript(filePath: string, runId: string, fallbackTime: string): RawEvent[] {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return [];
  }

  const cached = trajectoryCache.get(filePath);
  if (cached && cached.size === stats.size) return cached.events;

  const events: RawEvent[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  for (const line of raw.split("\n")) {
    if (events.length >= MAX_EVENTS_PER_RUN) break;
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    events.push(
      ...parseClaudeLine(obj, runId, fallbackTime),
      ...parseCodexLine(obj, runId, fallbackTime)
    );
  }

  trajectoryCache.set(filePath, { size: stats.size, events });
  return events;
}

/**
 * Trajectory for every archived run of a session, in run order, with turn_id
 * pointing at the user message that started each run (the shape the chat
 * UI's activity feed groups by).
 */
export function readSessionTrajectory(
  sessionId: string,
  runs: Array<{ runId: string; turnId: string | null; createdAt: string }>
): TrajectoryEvent[] {
  const { sessionRoot } = getLocalSessionPaths(sessionId);
  const events: TrajectoryEvent[] = [];
  let id = 1;

  for (const run of runs) {
    const filePath = path.join(sessionRoot, "transcripts", `${run.runId}.jsonl`);
    for (const event of parseTranscript(filePath, run.runId, run.createdAt)) {
      events.push({ ...event, id: id++, turn_id: run.turnId });
    }
  }

  return events;
}
