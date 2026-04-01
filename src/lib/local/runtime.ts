import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { isRegisteredModelId } from "@/lib/models";
import { getResolvedElevenLabsApiKey } from "@/lib/local/elevenlabs-config";

export interface ActiveLocalRunProcess {
  sessionId: string;
  sandboxId: string;
  runId: string | null;
  process: ChildProcessWithoutNullStreams;
  startedAt: string;
  canceled: boolean;
}

const activeBySandboxId = new Map<string, ActiveLocalRunProcess>();
const startingSessionIds = new Set<string>();
const pendingCancelBySessionId = new Set<string>();

const LOCAL_CLAUDE_ENV_KEYS_TO_REMOVE = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "PORTKEY_API_KEY",
  "PORTKEY_BASE_URL",
  "OPENAI_API_KEY",
] as const;

function cleanupEntry(sandboxId: string, pid: number | undefined): void {
  const current = activeBySandboxId.get(sandboxId);
  if (!current) return;
  if (pid && current.process.pid !== pid) return;
  activeBySandboxId.delete(sandboxId);
}

function isProcessDone(process: ChildProcessWithoutNullStreams): boolean {
  return process.exitCode !== null || process.signalCode !== null;
}

function waitForProcessExit(
  process: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<boolean> {
  if (isProcessDone(process)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const onExit = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    process.once("exit", onExit);
  });
}

function killProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    // Negative pid targets the entire process group (all children including manim)
    process.kill(-pid, signal);
  } catch {
    // Process group may already be gone.
  }
}

async function terminateLocalRunProcess(target: ActiveLocalRunProcess): Promise<void> {
  target.canceled = true;
  const pid = target.process.pid;

  if (pid) {
    killProcessGroup(pid, "SIGTERM");
  } else {
    try { target.process.kill("SIGTERM"); } catch { /* gone */ }
  }

  const exitedAfterTerm = await waitForProcessExit(target.process, 3000);
  if (exitedAfterTerm) return;

  if (pid) {
    killProcessGroup(pid, "SIGKILL");
  } else {
    try { target.process.kill("SIGKILL"); } catch { /* gone */ }
  }
  await waitForProcessExit(target.process, 500);
}

export function beginLocalRunStart(sessionId: string): boolean {
  if (startingSessionIds.has(sessionId) || getActiveLocalRunBySessionId(sessionId)) {
    return false;
  }
  startingSessionIds.add(sessionId);
  return true;
}

export function endLocalRunStart(sessionId: string): void {
  startingSessionIds.delete(sessionId);
  pendingCancelBySessionId.delete(sessionId);
}

function isLocalRunStarting(sessionId: string): boolean {
  return startingSessionIds.has(sessionId);
}

export function registerLocalRunProcess(input: {
  sessionId: string;
  sandboxId: string;
  runId: string | null;
  process: ChildProcessWithoutNullStreams;
}): void {
  const entry: ActiveLocalRunProcess = {
    sessionId: input.sessionId,
    sandboxId: input.sandboxId,
    runId: input.runId,
    process: input.process,
    startedAt: new Date().toISOString(),
    canceled: false,
  };
  activeBySandboxId.set(input.sandboxId, entry);

  input.process.once("exit", () => {
    cleanupEntry(input.sandboxId, input.process.pid);
  });
  input.process.once("error", () => {
    cleanupEntry(input.sandboxId, input.process.pid);
  });

  if (pendingCancelBySessionId.delete(input.sessionId)) {
    void terminateLocalRunProcess(entry);
  }
}

export function getActiveLocalRunBySandboxId(
  sandboxId: string
): ActiveLocalRunProcess | null {
  return activeBySandboxId.get(sandboxId) || null;
}

export function getActiveLocalRunBySessionId(
  sessionId: string
): ActiveLocalRunProcess | null {
  for (const entry of activeBySandboxId.values()) {
    if (entry.sessionId === sessionId) return entry;
  }
  return null;
}

export function clearLocalRunProcess(sandboxId: string): void {
  activeBySandboxId.delete(sandboxId);
}

export async function cancelLocalRunProcess(input: {
  sandboxId?: string | null;
  sessionId?: string | null;
  pid?: number | null;
}): Promise<{ success: boolean; message: string; runId?: string | null }> {
  const requestedSessionId = input.sessionId || input.sandboxId || null;
  const target =
    (input.sandboxId && getActiveLocalRunBySandboxId(input.sandboxId)) ||
    (input.sessionId && getActiveLocalRunBySessionId(input.sessionId)) ||
    null;

  if (!target) {
    if (requestedSessionId && isLocalRunStarting(requestedSessionId)) {
      pendingCancelBySessionId.add(requestedSessionId);
      return { success: true, message: "Local run is starting; cancellation queued" };
    }
    return { success: true, message: "No active local process" };
  }

  if (input.pid && target.process.pid !== input.pid) {
    return { success: true, message: "Requested process already exited", runId: target.runId };
  }

  await terminateLocalRunProcess(target);

  return { success: true, message: "Local Claude process canceled", runId: target.runId };
}

export function normalizeLocalClaudeModel(model: string | null | undefined): string | null {
  const candidate = model?.trim();
  if (!candidate) return null;

  const lower = candidate.toLowerCase();
  if (isRegisteredModelId(lower)) {
    return lower;
  }

  // Backward compatibility for existing sessions that still store full model IDs.
  if (lower.startsWith("claude-")) {
    return candidate;
  }
  return null;
}

export function buildLocalClaudeEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...sourceEnv };

  for (const key of LOCAL_CLAUDE_ENV_KEYS_TO_REMOVE) {
    delete env[key];
  }

  for (const key of Object.keys(env)) {
    if (key.startsWith("CODEX_")) {
      delete env[key];
    }
  }

  // Raise Claude CLI output token limit (default 32k is too low for Manim scripts).
  // 64000 is the effective upper limit for claude-4 model families in the CLI.
  // Only set if not already configured by the caller.
  if (!env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "64000";
  }

  return env;
}

export function spawnLocalClaudeProcess(input: {
  cwd: string;
  prompt: string;
  model?: string | null;
  resumeSessionId?: string | null;
}): ChildProcessWithoutNullStreams {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--allowedTools",
    "Task,TaskOutput,Bash,Glob,Grep,Read,Edit,Write,WebFetch,WebSearch,TaskStop,mcp__*",
  ];

  const normalizedModel = normalizeLocalClaudeModel(input.model);
  if (normalizedModel) {
    args.push("--model", normalizedModel);
  }

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }

  args.push("-p", input.prompt);
  const env = buildLocalClaudeEnv();
  const elevenLabsApiKey = getResolvedElevenLabsApiKey().apiKey;
  if (elevenLabsApiKey) {
    env.ELEVENLABS_API_KEY = elevenLabsApiKey;
  }

  const child = spawn("claude", args, {
    cwd: input.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // Own process group so kill(-pid) terminates the whole tree
  });

  // Keep stdin closed for print mode to avoid waiting on a never-ending pipe.
  child.stdin.end();

  return child;
}
