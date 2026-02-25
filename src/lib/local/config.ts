import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCAL_ROOT = path.join(os.homedir(), ".manimate");

export const LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT || DEFAULT_LOCAL_ROOT;
export const LOCAL_DB_PATH = path.join(LOCAL_ROOT, "db", "app.db");
export const LOCAL_SESSIONS_ROOT = path.join(LOCAL_ROOT, "sessions");
export const LOCAL_LOGS_ROOT = path.join(LOCAL_ROOT, "logs");

export function ensureLocalLayout(): void {
  fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });
  fs.mkdirSync(LOCAL_SESSIONS_ROOT, { recursive: true });
  fs.mkdirSync(LOCAL_LOGS_ROOT, { recursive: true });
}

export function sanitizeLocalId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getLocalSandboxId(sessionId: string): string {
  return sessionId;
}

export function getSessionIdFromSandboxId(sandboxId: string): string {
  return sandboxId;
}

export function getLocalSessionPaths(sessionId: string): {
  sessionRoot: string;
  projectDir: string;
  artifactsDir: string;
} {
  const safeId = sanitizeLocalId(sessionId);
  const sessionRoot = path.join(LOCAL_SESSIONS_ROOT, safeId);
  return {
    sessionRoot,
    projectDir: path.join(sessionRoot, "project"),
    artifactsDir: path.join(sessionRoot, "artifacts"),
  };
}

/**
 * Path to the canonical Manim expert prompt (CLAUDE.md) bundled in the repo.
 * This file is copied into each session's project dir so Claude CLI picks it up.
 * Uses process.cwd() (project root) since __dirname is unreliable in Next.js bundles.
 */
const MANIM_PROMPT_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "local",
  "prompts",
  "CLAUDE.md"
);

const SUBTITLE_LINTER_PATH = path.join(
  process.cwd(),
  "scripts",
  "lint-subtitles.py"
);

export function ensureLocalSessionLayout(sessionId: string): {
  sessionRoot: string;
  projectDir: string;
  artifactsDir: string;
} {
  ensureLocalLayout();
  const paths = getLocalSessionPaths(sessionId);
  fs.mkdirSync(paths.sessionRoot, { recursive: true });
  fs.mkdirSync(paths.projectDir, { recursive: true });
  fs.mkdirSync(paths.artifactsDir, { recursive: true });

  // Copy the Manim expert prompt into the project dir (only if missing).
  // Claude CLI auto-discovers CLAUDE.md in cwd and uses it as system context.
  const destClaudeMd = path.join(paths.projectDir, "CLAUDE.md");
  if (!fs.existsSync(destClaudeMd)) {
    try {
      fs.copyFileSync(MANIM_PROMPT_PATH, destClaudeMd);
    } catch {
      // Non-fatal: Claude will still work, just without the expert prompt.
    }
  }

  // Copy subtitle linter into project dir so prompt command works:
  // `python lint-subtitles.py script.py`
  const destSubtitleLinter = path.join(paths.projectDir, "lint-subtitles.py");
  if (!fs.existsSync(destSubtitleLinter)) {
    try {
      fs.copyFileSync(SUBTITLE_LINTER_PATH, destSubtitleLinter);
    } catch {
      // Non-fatal: Claude can still render without linter pre-check.
    }
  }

  return paths;
}

/**
 * Resolve a requested file path against a session workspace.
 *
 * Allowed forms:
 * - absolute path under session project directory
 * - relative path (resolved under project directory)
 */
export function resolveSessionFilePath(
  sessionId: string,
  requestedPath: string
): string | null {
  const raw = requestedPath.trim();
  if (!raw || raw.includes("\0")) return null;

  const { sessionRoot, projectDir } = ensureLocalSessionLayout(sessionId);
  const sessionRootResolved = path.resolve(sessionRoot);
  const projectRoot = path.resolve(projectDir);

  let candidate = raw;
  if (!path.isAbsolute(candidate)) {
    candidate = path.join(projectRoot, candidate);
  }

  const resolved = path.resolve(candidate);
  if (
    resolved === sessionRootResolved ||
    resolved.startsWith(`${sessionRootResolved}${path.sep}`)
  ) {
    return resolved;
  }
  return null;
}

export function localFileToApiUrl(
  sessionId: string,
  absolutePath: string,
  version?: string | number | null
): string {
  const base = `/api/files?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(absolutePath)}`;
  if (version === undefined || version === null || String(version).length === 0) {
    return base;
  }
  return `${base}&_v=${encodeURIComponent(String(version))}`;
}
