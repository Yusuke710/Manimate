import fs from "node:fs";
import { readConfiguredCliModels } from "@/lib/local/cli-models";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getLocalSessionPaths } from "@/lib/local/config";

/**
 * Rebuilds a display-friendly agent trajectory from the verbatim CLI
 * transcripts archived in <session>/transcripts/<run>.jsonl.
 *
 * This is a read-only, best-effort view over the Claude Code / Codex native
 * formats: unknown line shapes are skipped, text is truncated, and parses are
 * cached by path, run start, and file size. Completed runs use their durable
 * archives; active runs read the growing CLI transcript to recover live
 * activity after refresh. Nothing here is a second store of events.
 */

export interface TrajectoryEvent {
  id: number;
  run_id: string;
  turn_id: string | null;
  type: "system_init" | "assistant_text" | "tool_use" | "tool_result";
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

  const cacheKey = `${filePath}:${fallbackTime}`;
  const cached = trajectoryCache.get(cacheKey);
  if (cached && cached.size === stats.size) return cached.events;

  const events: RawEvent[] = [];
  let detectedModel: string | null = null;
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
    // Resumed CLI archives contain the entire session. Exclude previous
    // turns before applying the event limit, otherwise old history crowds
    // out the current run and appears under the wrong user message.
    if (typeof obj.timestamp === "string" &&
        Date.parse(obj.timestamp) < Date.parse(fallbackTime)) continue;
    const messageModel = (obj.message as { model?: unknown } | undefined)?.model;
    const contextModel = obj.type === "turn_context" ? (obj.payload as { model?: unknown } | undefined)?.model : null;
    const candidate = messageModel || contextModel;
    if (!detectedModel && typeof candidate === "string" && candidate !== "<synthetic>") detectedModel = candidate;
    events.push(
      ...parseClaudeLine(obj, runId, fallbackTime),
      ...parseCodexLine(obj, runId, fallbackTime)
    );
  }

  if (detectedModel) events.unshift({
    ...eventBase(runId, fallbackTime), type: "system_init",
    message: "Manimate connected", payload: { model: detectedModel },
  });
  trajectoryCache.set(cacheKey, { size: stats.size, events });
  return events;
}

/**
 * Trajectory for every archived run of a session, in run order, with turn_id
 * pointing at the user message that started each run (the shape the chat
 * UI's activity feed groups by).
 */
export function readSessionTrajectory(
  sessionId: string,
  runs: Array<{ runId: string; turnId: string | null; createdAt: string; transcriptPath?: string }>
): TrajectoryEvent[] {
  const { sessionRoot } = getLocalSessionPaths(sessionId);
  const events: TrajectoryEvent[] = [];
  let id = 1;

  for (const run of runs) {
    const filePath = run.transcriptPath || path.join(sessionRoot, "transcripts", `${run.runId}.jsonl`);
    for (const event of parseTranscript(filePath, run.runId, run.createdAt)) {
      events.push({ ...event, id: id++, turn_id: run.turnId });
    }
  }

  return events;
}

/** Reconnect to an in-progress CLI transcript without creating an archive. */
export async function readSessionDisplayTrajectory(
  sessionId: string,
  model: string,
  runs: Array<{
    runId: string;
    turnId: string | null;
    createdAt: string;
    agentSessionId?: string | null;
    active?: boolean;
    cliModel?: string | null;
  }>,
): Promise<TrajectoryEvent[]> {
  const { projectDir } = getLocalSessionPaths(sessionId);
  const sources = await Promise.all(runs.map(async run => {
    if (!run.active || !run.agentSessionId) return run;
    const transcriptPath = model === "codex"
      ? await findCodexTranscriptPath(run.agentSessionId)
      : claudeTranscriptPath(projectDir, run.agentSessionId);
    return { ...run, transcriptPath: transcriptPath || undefined };
  }));
  const events = readSessionTrajectory(sessionId, sources);
  let id = 1;
  return runs.flatMap((run, index) => {
    const runEvents = events.filter(event => event.run_id === run.runId);
    const detected = runEvents.find(event => event.type === "system_init")?.payload?.model;
    const cliModel = typeof detected === "string" ? detected : run.cliModel
      || (run.active ? readConfiguredCliModels().find(entry => entry.id === model)?.configuredModel : null)
      || "CLI default";
    const label = cliModel;
    const connection: TrajectoryEvent = {
      id: id++, run_id: run.runId, turn_id: run.turnId, created_at: run.createdAt,
      type: "system_init", message: `${index === 0 ? "Manimate connected" : "Manimate reconnected"} · ${label}`,
      payload: { model: label },
    };
    return [connection, ...runEvents.filter(event => event.type !== "system_init").map(event => ({ ...event, id: id++ }))];
  });
}

// ---------------------------------------------------------------------------
// Transcript archival
// ---------------------------------------------------------------------------

/**
 * Preserve the exact agentic trace: copy the CLI's own JSONL transcript into
 * the session directory when a run finishes. Claude Code auto-deletes its
 * transcripts after ~30 days (cleanupPeriodDays); this copy is the durable
 * record. The files are kept verbatim — the Claude Code / Codex formats are
 * rendered as-is by the Hugging Face Hub trace viewer.
 */

function claudeTranscriptPath(cwd: string, agentSessionId: string): string {
  // Claude Code encodes the project cwd by replacing every non-alphanumeric
  // character with "-" (verified: /Users/x/.manimate/... -> -Users-x--manimate-...).
  const encoded = path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded, `${agentSessionId}.jsonl`);
}

async function findCodexTranscriptPath(agentSessionId: string): Promise<string | null> {
  // Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl.
  const root = path.join(os.homedir(), ".codex", "sessions");
  const suffix = `-${agentSessionId}.jsonl`;
  try {
    const entries = await fsp.readdir(root, { recursive: true });
    const match = entries.find((entry) => entry.endsWith(suffix));
    return match ? path.join(root, match) : null;
  } catch {
    return null;
  }
}

export async function copyAgentTranscript(input: {
  sessionId: string;
  runId: string;
  model: string;
  cwd: string;
  agentSessionId: string;
}): Promise<string | null> {
  if (!input.agentSessionId) return null;

  const sourcePath =
    input.model === "codex"
      ? await findCodexTranscriptPath(input.agentSessionId)
      : claudeTranscriptPath(input.cwd, input.agentSessionId);
  if (!sourcePath) return null;

  const { sessionRoot } = getLocalSessionPaths(input.sessionId);
  const targetDir = path.join(sessionRoot, "transcripts");
  const targetPath = path.join(targetDir, `${input.runId}.jsonl`);

  try {
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.copyFile(sourcePath, targetPath);
    return targetPath;
  } catch {
    // Non-fatal: the run itself succeeded; only the trace copy is missed.
    return null;
  }
}
