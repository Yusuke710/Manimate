import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCAL_ROOT = path.join(os.homedir(), ".manimate");
const PACKAGE_ROOT = process.env.MANIMATE_PACKAGE_ROOT?.trim() || process.cwd();

export const LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT || DEFAULT_LOCAL_ROOT;
export const LOCAL_SESSIONS_ROOT = path.join(LOCAL_ROOT, "sessions");
export const LOCAL_LOGS_ROOT = path.join(LOCAL_ROOT, "logs");

export function ensureLocalLayout(): void {
  fs.mkdirSync(LOCAL_SESSIONS_ROOT, { recursive: true });
  fs.mkdirSync(LOCAL_LOGS_ROOT, { recursive: true });
}

export function sanitizeLocalId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
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

const PROMPTS_PATH = path.join(PACKAGE_ROOT, "src", "lib", "local", "prompts");
export type RenderMode = "cloud" | "local";

export function selectedRenderMode(): RenderMode | null {
  let mode = process.env.MANIMATE_RENDER_MODE;
  if (!mode) {
    const configPath = path.join(LOCAL_ROOT, "config.json");
    if (fs.existsSync(configPath)) mode = JSON.parse(fs.readFileSync(configPath, "utf8")).render_mode;
  }
  if (mode === undefined || mode === "") return null;
  if (mode !== "cloud" && mode !== "local") throw new Error("render_mode must be cloud or local");
  return mode;
}

function syncTextFile(source: string, destination: string): void {
  const content = fs.readFileSync(source, "utf8");
  if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== content) {
    fs.writeFileSync(destination, content);
  }
}

function syncRuntimePrompt(projectDir: string, mode: RenderMode): void {
  syncTextFile(path.join(PROMPTS_PATH, mode, "AGENTS.md"), path.join(projectDir, "AGENTS.md"));
  fs.rmSync(path.join(projectDir, "CLAUDE.md"), { force: true });
}

export function ensureLocalSessionLayout(
  sessionId: string,
  options?: { model?: string | null; renderMode?: RenderMode }
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
    syncRuntimePrompt(paths.projectDir, options.renderMode ?? selectedRenderMode() ?? "cloud");
  }

  // Standalone helpers stay available to the agent in its project directory.
  for (const [source, destination, optional] of [
    ["tts-generate.py", "tts-generate.py", true],
    ["lint-subtitles.py", "lint-subtitles.py", true],
    ["speech_client.py", "speech_client.py", false],
    ["manim-cloud/cloud_auth.py", "manimate_cloud_auth.py", false],
  ] as const) {
    try {
      syncTextFile(path.join(PACKAGE_ROOT, "scripts", source), path.join(paths.projectDir, destination));
    } catch (error) {
      if (!optional) throw error;
    }
  }

  return paths;
}

/**
 * Resolve a requested file path against a session workspace.
 *
 * Allowed forms:
 * - absolute path under session directory (including thumbnails/artifacts)
 * - relative path (resolved under project directory)
 */
export function resolveSessionFilePath(
  sessionId: string,
  requestedPath: string
): string | null {
  const raw = requestedPath.trim();
  if (!raw || raw.includes("\0")) return null;

  const { sessionRoot, projectDir } = getLocalSessionPaths(sessionId);
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
    // Check real paths too: a workspace symlink must not expose outside files.
    // Read requests must not recreate sessions or rewrite runtime helpers.
    try {
      const realRoot = fs.realpathSync(/* turbopackIgnore: true */ sessionRootResolved);
      const realFile = fs.realpathSync(/* turbopackIgnore: true */ resolved);
      if (realFile === realRoot || realFile.startsWith(`${realRoot}${path.sep}`)) {
        return realFile;
      }
    } catch {
      // Keep missing paths so callers can return their usual 404 response.
      return resolved;
    }
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
