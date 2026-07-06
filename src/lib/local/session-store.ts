import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  LOCAL_SESSIONS_ROOT,
  ensureLocalLayout,
  getLocalSandboxId,
  getLocalSessionPaths,
  localFileToApiUrl,
  sanitizeLocalId,
} from "@/lib/local/config";
import { shouldRetryCloudSyncSession } from "@/lib/local/cloud-sync-policy";

export const SESSION_FILE_VERSION = 2;
const SESSION_FILE_NAME = "session.json";

// ---------------------------------------------------------------------------
// On-disk schema (session.json, version 2)
// ---------------------------------------------------------------------------

export interface StoredRun {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  pid: number | null;
  agent_session_id: string | null;
  started_at: string | null;
  last_event_at: string | null;
  finished_at: string | null;
  error: string | null;
  video_url: string | null;
  created_at: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  run?: StoredRun;
}

export interface StoredSession {
  version: number;
  id: string;
  session_number: number;
  title: string;
  status: string;
  model: string;
  agent_session_id: string | null;
  aspect_ratio: string | null;
  voice_id: string | null;
  created_at: string;
  updated_at: string;
  last_user_activity_at: string;
  video: {
    path: string; // relative to session root, e.g. "project/video.mp4"
    version: number | null;
    chapters: unknown[] | null;
  } | null;
  cloud: {
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    public_video_url: string | null;
  };
  messages: StoredMessage[];
}

// ---------------------------------------------------------------------------
// Compatibility shapes (mirror the old db.ts types so call sites stay small)
// ---------------------------------------------------------------------------

export interface LocalSession {
  id: string;
  session_number: number;
  title: string;
  status: string;
  sandbox_id: string | null;
  agent_session_id: string | null;
  model: string;
  aspect_ratio: string | null;
  voice_id: string | null;
  video_path: string | null;
  last_video_url: string | null;
  chapters: string | null;
  cloud_sync_status: string;
  cloud_last_synced_at: string | null;
  cloud_last_error: string | null;
  cloud_public_video_url: string | null;
  last_user_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export type LocalSessionSummary = Pick<
  LocalSession,
  | "id"
  | "session_number"
  | "title"
  | "status"
  | "last_user_activity_at"
  | "created_at"
  | "updated_at"
> & {
  has_video: boolean;
};

export interface LocalMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LocalRun {
  id: string;
  session_id: string;
  user_message_id: string | null;
  status: StoredRun["status"];
  sandbox_id: string | null;
  agent_session_id: string | null;
  pid: number | null;
  started_at: string | null;
  last_event_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  video_url: string | null;
  created_at: string;
}

export interface SessionArtifacts {
  plan_content: string | null;
  script_content: string | null;
  subtitles_content: string | null;
}

type SessionUpdateInput = Partial<{
  title: string;
  status: string;
  agent_session_id: string | null;
  model: string;
  aspect_ratio: string | null;
  voice_id: string | null;
  video_path: string | null;
  chapters: string | null;
  cloud_sync_status: string;
  cloud_last_synced_at: string | null;
  cloud_last_error: string | null;
  cloud_public_video_url: string | null;
}>;

type RunUpdateInput = Partial<{
  status: StoredRun["status"];
  agent_session_id: string | null;
  pid: number | null;
  started_at: string | null;
  last_event_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  video_url: string | null;
}>;

// ---------------------------------------------------------------------------
// File cache. Survives dev-mode HMR the same way runtime.ts's registry does.
// Entries are validated against session.json mtime+size on every read, so a
// file edited outside this process is picked up automatically.
// ---------------------------------------------------------------------------

type CacheEntry = { mtimeMs: number; size: number; data: StoredSession };

const cacheHost = globalThis as typeof globalThis & {
  __manimateSessionFileCache?: Map<string, CacheEntry>;
};
const fileCache: Map<string, CacheEntry> = (cacheHost.__manimateSessionFileCache ??= new Map());

function sessionFilePath(sessionId: string): string {
  return path.join(LOCAL_SESSIONS_ROOT, sanitizeLocalId(sessionId), SESSION_FILE_NAME);
}

function readStoredSession(sessionId: string): StoredSession | null {
  const filePath = sessionFilePath(sessionId);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    fileCache.delete(filePath);
    return null;
  }

  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.data;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredSession;
    if (!data || typeof data !== "object" || typeof data.id !== "string") return null;
    if (!Array.isArray(data.messages)) data.messages = [];
    fileCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, data });
    return data;
  } catch {
    return null;
  }
}

/**
 * Atomic write: temp file + rename, so a crash mid-write never corrupts a
 * session. Synchronous on purpose — mutations are read-modify-write with no
 * awaits in between, which makes them serialized by the event loop without
 * needing an explicit per-session lock.
 */
function writeStoredSession(data: StoredSession): void {
  const filePath = sessionFilePath(data.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
  const stats = fs.statSync(filePath);
  fileCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, data });
}

function mutateStoredSession(
  sessionId: string,
  mutate: (data: StoredSession) => void
): StoredSession | null {
  const data = readStoredSession(sessionId);
  if (!data) return null;
  // Work on a deep copy so a failed write never leaves the cache ahead of disk.
  const next = structuredClone(data);
  mutate(next);
  writeStoredSession(next);
  return next;
}

// ---------------------------------------------------------------------------
// Mapping between stored schema and the compat shapes
// ---------------------------------------------------------------------------

function absoluteVideoPath(data: StoredSession): string | null {
  if (!data.video?.path) return null;
  const { sessionRoot } = getLocalSessionPaths(data.id);
  return path.join(sessionRoot, data.video.path);
}

function toRelativeVideoPath(sessionId: string, videoPath: string): string {
  const { sessionRoot } = getLocalSessionPaths(sessionId);
  const relative = path.relative(sessionRoot, videoPath);
  return relative.startsWith("..") ? videoPath : relative;
}

function lastVideoUrl(data: StoredSession): string | null {
  const videoPath = absoluteVideoPath(data);
  if (!videoPath) return null;
  return localFileToApiUrl(data.id, videoPath, data.video?.version ?? undefined);
}

function serializeChapters(data: StoredSession): string | null {
  if (!data.video?.chapters || data.video.chapters.length === 0) return null;
  try {
    return JSON.stringify(data.video.chapters);
  } catch {
    return null;
  }
}

function parseChapters(serialized: string | null | undefined): unknown[] | null {
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function mapSession(data: StoredSession): LocalSession {
  return {
    id: data.id,
    session_number: data.session_number || 0,
    title: data.title,
    status: data.status || "active",
    sandbox_id: getLocalSandboxId(data.id),
    agent_session_id: data.agent_session_id,
    model: data.model,
    aspect_ratio: data.aspect_ratio,
    voice_id: data.voice_id,
    video_path: absoluteVideoPath(data),
    last_video_url: lastVideoUrl(data),
    chapters: serializeChapters(data),
    cloud_sync_status: data.cloud?.status || "idle",
    cloud_last_synced_at: data.cloud?.last_synced_at ?? null,
    cloud_last_error: data.cloud?.last_error ?? null,
    cloud_public_video_url: data.cloud?.public_video_url ?? null,
    last_user_activity_at: data.last_user_activity_at || null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

function mapSummary(data: StoredSession): LocalSessionSummary {
  return {
    id: data.id,
    session_number: data.session_number || 0,
    title: data.title,
    status: data.status || "active",
    has_video: Boolean(data.video?.path || data.cloud?.public_video_url),
    last_user_activity_at: data.last_user_activity_at || null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

function mapRun(data: StoredSession, message: StoredMessage): LocalRun {
  const run = message.run as StoredRun;
  return {
    id: run.id,
    session_id: data.id,
    user_message_id: message.id,
    status: run.status,
    sandbox_id: getLocalSandboxId(data.id),
    agent_session_id: run.agent_session_id,
    pid: run.pid,
    started_at: run.started_at,
    last_event_at: run.last_event_at,
    finished_at: run.finished_at,
    error_message: run.error,
    video_url: run.video_url,
    created_at: run.created_at,
  };
}

function listStoredSessions(): StoredSession[] {
  ensureLocalLayout();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(LOCAL_SESSIONS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: StoredSession[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const data = readStoredSession(entry.name);
    if (data) sessions.push(data);
  }
  return sessions;
}

function activityKey(data: StoredSession): string {
  return data.last_user_activity_at || data.created_at || data.updated_at || "";
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function listLocalSessionSummaries(): LocalSessionSummary[] {
  return listStoredSessions()
    .sort((a, b) => activityKey(b).localeCompare(activityKey(a)))
    .map(mapSummary);
}

export function listLocalSessions(): LocalSession[] {
  return listStoredSessions()
    .sort((a, b) => activityKey(b).localeCompare(activityKey(a)))
    .map(mapSession);
}

export function createLocalSession(input: {
  id?: string;
  model: string;
  aspect_ratio?: string | null;
  voice_id?: string | null;
}): LocalSession {
  ensureLocalLayout();
  const now = new Date().toISOString();
  const id = input.id || randomUUID();

  const maxSessionNumber = listStoredSessions().reduce(
    (max, session) => Math.max(max, session.session_number || 0),
    0
  );

  const data: StoredSession = {
    version: SESSION_FILE_VERSION,
    id,
    session_number: maxSessionNumber + 1,
    title: "Untitled Animation",
    status: "active",
    model: input.model,
    agent_session_id: null,
    aspect_ratio: input.aspect_ratio ?? null,
    voice_id: input.voice_id ?? null,
    created_at: now,
    updated_at: now,
    last_user_activity_at: now,
    video: null,
    cloud: {
      status: "idle",
      last_synced_at: null,
      last_error: null,
      public_video_url: null,
    },
    messages: [],
  };

  writeStoredSession(data);
  return mapSession(data);
}

export function getLocalSession(sessionId: string): LocalSession | null {
  const data = readStoredSession(sessionId);
  return data ? mapSession(data) : null;
}

/** Read plan/script/subtitles from the project dir (they are never stored in session.json). */
export function readLocalSessionArtifacts(sessionId: string): SessionArtifacts {
  const { projectDir } = getLocalSessionPaths(sessionId);
  const readIfExists = (name: string): string | null => {
    try {
      return fs.readFileSync(path.join(projectDir, name), "utf8");
    } catch {
      return null;
    }
  };
  return {
    plan_content: readIfExists("plan.md"),
    script_content: readIfExists("script.py"),
    subtitles_content: readIfExists("subtitles.srt"),
  };
}

export function findLocalSessionWithChaptersByTitle(title: string): LocalSession | null {
  const match = listStoredSessions()
    .filter((data) => data.title === title && (data.video?.chapters?.length ?? 0) > 0)
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
  return match ? mapSession(match) : null;
}

export function listLocalCloudSyncRetryCandidates(options?: {
  includeAuthFailures?: boolean;
}): LocalSession[] {
  const candidates = listStoredSessions()
    .filter(
      (data) =>
        Boolean(data.video?.path) &&
        ["idle", "pending", "syncing", "failed"].includes(data.cloud?.status || "idle")
    )
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .map(mapSession);

  if (options?.includeAuthFailures) return candidates;
  return candidates.filter((session) =>
    shouldRetryCloudSyncSession({
      cloudSyncStatus: session.cloud_sync_status,
      cloudLastError: session.cloud_last_error,
    })
  );
}

const CLOUD_ONLY_KEYS: ReadonlySet<keyof SessionUpdateInput> = new Set([
  "cloud_sync_status",
  "cloud_last_synced_at",
  "cloud_last_error",
  "cloud_public_video_url",
]);

export function updateLocalSession(sessionId: string, updates: SessionUpdateInput): void {
  const keys = Object.keys(updates) as Array<keyof SessionUpdateInput>;
  if (keys.length === 0) return;

  mutateStoredSession(sessionId, (data) => {
    if (updates.title !== undefined) data.title = updates.title;
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.agent_session_id !== undefined) data.agent_session_id = updates.agent_session_id;
    if (updates.model !== undefined) data.model = updates.model;
    if (updates.aspect_ratio !== undefined) data.aspect_ratio = updates.aspect_ratio;
    if (updates.voice_id !== undefined) data.voice_id = updates.voice_id;

    if (updates.video_path !== undefined) {
      if (updates.video_path === null) {
        data.video = null;
      } else {
        let version: number | null = null;
        try {
          version = Math.round(fs.statSync(updates.video_path).mtimeMs);
        } catch {
          // Keep null version; URLs simply omit the cache-buster.
        }
        data.video = {
          path: toRelativeVideoPath(sessionId, updates.video_path),
          version,
          chapters: data.video?.chapters ?? null,
        };
      }
    }
    if (updates.chapters !== undefined) {
      const chapters = parseChapters(updates.chapters);
      if (data.video) {
        data.video.chapters = chapters;
      } else if (chapters) {
        // Chapters can arrive before the video path is recorded (handoff).
        data.video = { path: "project/video.mp4", version: null, chapters };
      }
    }

    if (updates.cloud_sync_status !== undefined) data.cloud.status = updates.cloud_sync_status;
    if (updates.cloud_last_synced_at !== undefined) data.cloud.last_synced_at = updates.cloud_last_synced_at;
    if (updates.cloud_last_error !== undefined) data.cloud.last_error = updates.cloud_last_error;
    if (updates.cloud_public_video_url !== undefined) data.cloud.public_video_url = updates.cloud_public_video_url;

    const touchesContent = keys.some((key) => !CLOUD_ONLY_KEYS.has(key));
    if (touchesContent) {
      const now = new Date().toISOString();
      data.updated_at = now;
      data.last_user_activity_at = now;
    }
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function insertLocalMessage(input: {
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const id = randomUUID();
  mutateStoredSession(input.session_id, (data) => {
    data.messages.push({
      id,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? null,
      created_at: new Date().toISOString(),
    });
  });
  return id;
}

export function listLocalMessages(sessionId: string): LocalMessage[] {
  const data = readStoredSession(sessionId);
  if (!data) return [];
  return data.messages.map((message) => ({
    id: message.id,
    session_id: data.id,
    role: message.role,
    content: message.content,
    metadata: message.metadata,
    created_at: message.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Runs (stored inline on the user message that started them)
// ---------------------------------------------------------------------------

export function createLocalRun(input: {
  session_id: string;
  user_message_id: string;
  agent_session_id?: string | null;
}): LocalRun {
  const now = new Date().toISOString();
  const run: StoredRun = {
    id: randomUUID(),
    status: "queued",
    pid: null,
    agent_session_id: input.agent_session_id ?? null,
    started_at: null,
    last_event_at: now,
    finished_at: null,
    error: null,
    video_url: null,
    created_at: now,
  };

  const data = mutateStoredSession(input.session_id, (next) => {
    const message = next.messages.find((m) => m.id === input.user_message_id);
    if (!message) {
      throw new Error(`Message ${input.user_message_id} not found in session ${input.session_id}`);
    }
    message.run = run;
  });
  if (!data) {
    throw new Error(`Failed to create run for session ${input.session_id}`);
  }

  const message = data.messages.find((m) => m.id === input.user_message_id);
  return mapRun(data, message as StoredMessage);
}

export function getLocalRun(sessionId: string, runId: string): LocalRun | null {
  const data = readStoredSession(sessionId);
  if (!data) return null;
  const message = data.messages.find((m) => m.run?.id === runId);
  return message ? mapRun(data, message) : null;
}

export function getLocalActiveRun(sessionId: string): LocalRun | null {
  const data = readStoredSession(sessionId);
  if (!data) return null;
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const message = data.messages[i];
    if (message.run && (message.run.status === "queued" || message.run.status === "running")) {
      return mapRun(data, message);
    }
  }
  return null;
}

export function listLocalRuns(sessionId: string): LocalRun[] {
  const data = readStoredSession(sessionId);
  if (!data) return [];
  return data.messages.filter((m) => m.run).map((m) => mapRun(data, m));
}

export function updateLocalRun(
  sessionId: string,
  runId: string,
  updates: RunUpdateInput
): void {
  mutateStoredSession(sessionId, (data) => {
    const message = data.messages.find((m) => m.run?.id === runId);
    const run = message?.run;
    if (!run) return;
    if (updates.status !== undefined) run.status = updates.status;
    if (updates.agent_session_id !== undefined) run.agent_session_id = updates.agent_session_id;
    if (updates.pid !== undefined) run.pid = updates.pid;
    if (updates.started_at !== undefined) run.started_at = updates.started_at;
    if (updates.last_event_at !== undefined) run.last_event_at = updates.last_event_at;
    if (updates.finished_at !== undefined) run.finished_at = updates.finished_at;
    if (updates.error_message !== undefined) run.error = updates.error_message;
    if (updates.video_url !== undefined) run.video_url = updates.video_url;
  });
}
