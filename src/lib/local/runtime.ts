import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync, spawn } from "node:child_process";
import { getResolvedElevenLabsApiKey } from "@/lib/local/voiceover";
import { DEFAULT_MODEL } from "@/lib/models";
import { NONE_VOICE_ID } from "@/lib/voices";

export interface ActiveLocalRunProcess {
  sessionId: string;
  sandboxId: string;
  runId: string | null;
  process: ChildProcessWithoutNullStreams;
  startedAt: string;
  canceled: boolean;
}

interface LocalRunRegistry {
  activeBySandboxId: Map<string, ActiveLocalRunProcess>;
  startingSessionIds: Set<string>;
  pendingCancelBySessionId: Set<string>;
}

// Stored on globalThis: Next.js dev-mode HMR re-instantiates this module while
// spawned agent processes keep running. Module-scoped maps would come back
// empty, making live runs invisible to the polling/cancel routes.
const registryHost = globalThis as typeof globalThis & {
  __manimateLocalRunRegistry?: LocalRunRegistry;
};
const localRunRegistry: LocalRunRegistry = (registryHost.__manimateLocalRunRegistry ??= {
  activeBySandboxId: new Map(),
  startingSessionIds: new Set(),
  pendingCancelBySessionId: new Set(),
});
const { activeBySandboxId, startingSessionIds, pendingCancelBySessionId } = localRunRegistry;

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

function isKokoroVoiceId(voiceId: string): boolean {
  return voiceId !== NONE_VOICE_ID && /^[a-z]{1,2}_[a-z0-9_]{2,64}$/.test(voiceId);
}

export function prewarmLocalKokoroVoice(input: { cwd: string; voiceId: string }): void {
  if (!isKokoroVoiceId(input.voiceId)) return;

  const python = process.env.MANIMATE_TTS_PYTHON?.trim() || "python";
  const env = buildLocalClaudeEnv();
  const child = spawn(
    python,
    ["tts-generate.py", "--prewarm-kokoro", "--provider", "kokoro", "--voice", input.voiceId],
    {
      cwd: input.cwd,
      env,
      stdio: "ignore",
      detached: true,
    }
  );

  child.unref();
  child.once("error", () => {
    // Prewarm is opportunistic. The regular TTS command will surface setup errors if needed.
  });
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

/**
 * Terminate an agent process group that outlived its tracked run (e.g. the
 * dev server restarted while a detached agent kept running). Verifies the pid
 * still belongs to an agent CLI before signaling, so a recycled pid is safe.
 */
export function killOrphanedAgentProcessGroup(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform === "win32") return false;

  let command = "";
  try {
    command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
  } catch {
    return false; // Process already gone.
  }
  if (!/(^|\/|\s)(claude|codex)(\s|$)/.test(command)) return false;

  killProcessGroup(pid, "SIGTERM");
  return true;
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

  return { success: true, message: "Local agent process canceled", runId: target.runId };
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

export function buildClaudeArgs(input: {
  prompt: string;
  resumeSessionId?: string | null;
}): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--allowedTools",
    "Task,TaskOutput,Bash,Glob,Grep,Read,Edit,Write,WebFetch,WebSearch,TaskStop,mcp__*",
  ];

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }

  args.push("-p", input.prompt);
  return args;
}

export function buildCodexArgs(input: {
  cwd: string;
  prompt: string;
  resumeSessionId?: string | null;
}): string[] {
  const args = ["exec"];

  if (input.resumeSessionId) {
    args.push("resume");
  }

  args.push(
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox"
  );

  if (!input.resumeSessionId) {
    args.push("--cd", input.cwd);
  } else {
    args.push(input.resumeSessionId);
  }

  args.push(input.prompt);
  return args;
}

function buildLocalAgentEnv(model: string): NodeJS.ProcessEnv {
  const env = model === DEFAULT_MODEL ? buildLocalClaudeEnv() : { ...process.env };
  const elevenLabsApiKey = getResolvedElevenLabsApiKey().apiKey;
  if (elevenLabsApiKey) {
    env.ELEVENLABS_API_KEY = elevenLabsApiKey;
  }

  return env;
}

export function spawnLocalAgentProcess(input: {
  cwd: string;
  prompt: string;
  model?: string | null;
  resumeSessionId?: string | null;
}): ChildProcessWithoutNullStreams {
  const model = input.model || DEFAULT_MODEL;
  const command = model === "codex" ? "codex" : "claude";
  const args = command === "codex" ? buildCodexArgs(input) : buildClaudeArgs(input);
  const env = buildLocalAgentEnv(model);

  const child = spawn(command, args, {
    cwd: input.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // Own process group so kill(-pid) terminates the whole tree
  });

  // Keep stdin closed for print mode to avoid waiting on a never-ending pipe.
  child.stdin.end();

  return child;
}
