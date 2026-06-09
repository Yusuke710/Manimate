import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCAL_ROOT = path.join(os.homedir(), ".manimate");
const PACKAGE_ROOT = process.env.MANIMATE_PACKAGE_ROOT?.trim() || process.cwd();

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

const CLAUDE_PROMPT_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "lib",
  "local",
  "prompts",
  "CLAUDE.md"
);

const AGENTS_PROMPT_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "lib",
  "local",
  "prompts",
  "AGENTS.md"
);

const TTS_GENERATE_PATH = path.join(
  PACKAGE_ROOT,
  "scripts",
  "tts-generate.py"
);

const SUBTITLE_LINTER_PATH = path.join(
  PACKAGE_ROOT,
  "scripts",
  "lint-subtitles.py"
);

function copyFileIfMissingOrChanged(sourcePath: string, destPath: string): void {
  try {
    const nextContent = fs.readFileSync(sourcePath);
    const currentContent = fs.existsSync(destPath) ? fs.readFileSync(destPath) : null;
    if (!currentContent || !currentContent.equals(nextContent)) {
      fs.writeFileSync(destPath, nextContent);
    }
  } catch {
    // Non-fatal: Claude can still run, but may miss optional bundled helpers.
  }
}

function removeFileIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Non-fatal: stale prompt cleanup should not block the run.
  }
}

function syncRuntimePrompt(projectDir: string, model: string): void {
  const destClaudeMd = path.join(projectDir, "CLAUDE.md");
  const destAgentsMd = path.join(projectDir, "AGENTS.md");

  if (model === "codex") {
    copyFileIfMissingOrChanged(AGENTS_PROMPT_PATH, destAgentsMd);
    removeFileIfExists(destClaudeMd);
    return;
  }

  copyFileIfMissingOrChanged(CLAUDE_PROMPT_PATH, destClaudeMd);
  removeFileIfExists(destAgentsMd);
}

export function ensureLocalSessionLayout(
  sessionId: string,
  options?: { model?: string | null }
): {
  sessionRoot: string;
  projectDir: string;
  artifactsDir: string;
} {
  ensureLocalLayout();
  const paths = getLocalSessionPaths(sessionId);
  fs.mkdirSync(paths.sessionRoot, { recursive: true });
  fs.mkdirSync(paths.projectDir, { recursive: true });
  fs.mkdirSync(paths.artifactsDir, { recursive: true });

  if (options?.model) {
    syncRuntimePrompt(paths.projectDir, options.model);
  }

  // Copy TTS generator into project dir so the selected agent can run:
  // `python tts-generate.py --plan plan.md`
  const destTtsGenerate = path.join(paths.projectDir, "tts-generate.py");
  if (!fs.existsSync(destTtsGenerate)) {
    try {
      fs.copyFileSync(TTS_GENERATE_PATH, destTtsGenerate);
    } catch {
      // Non-fatal: TTS step will fail gracefully if script is missing.
    }
  }

  // Copy subtitle linter into project dir so the selected agent can run:
  // `python lint-subtitles.py script.py`
  const destSubtitleLinter = path.join(paths.projectDir, "lint-subtitles.py");
  if (!fs.existsSync(destSubtitleLinter)) {
    try {
      fs.copyFileSync(SUBTITLE_LINTER_PATH, destSubtitleLinter);
    } catch {
      // Non-fatal: rendering can proceed without this pre-check.
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
