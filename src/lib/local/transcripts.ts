import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getLocalSessionPaths } from "@/lib/local/config";

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
