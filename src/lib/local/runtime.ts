import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { isRegisteredModelId } from "@/lib/models";

export interface ActiveLocalRunProcess {
  sessionId: string;
  sandboxId: string;
  runId: string | null;
  process: ChildProcessWithoutNullStreams;
  startedAt: string;
  canceled: boolean;
}

const activeBySandboxId = new Map<string, ActiveLocalRunProcess>();

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
  const target =
    (input.sandboxId && getActiveLocalRunBySandboxId(input.sandboxId)) ||
    (input.sessionId && getActiveLocalRunBySessionId(input.sessionId)) ||
    null;

  if (!target) {
    return { success: true, message: "No active local process" };
  }

  if (input.pid && target.process.pid !== input.pid) {
    return { success: true, message: "Requested process already exited", runId: target.runId };
  }

  target.canceled = true;

  try {
    target.process.kill("SIGTERM");
  } catch {
    // Process may already be gone.
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  if (!target.process.killed) {
    try {
      target.process.kill("SIGKILL");
    } catch {
      // Ignore final kill failure.
    }
  }

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

  const child = spawn("claude", args, {
    cwd: input.cwd,
    env: buildLocalClaudeEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Keep stdin closed for print mode to avoid waiting on a never-ending pipe.
  child.stdin.end();

  return child;
}
