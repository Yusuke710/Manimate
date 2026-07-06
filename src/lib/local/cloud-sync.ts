/**
 * Cloud sync: everything that talks to hosted Manimate (manimate.ai).
 *
 * One module, four concerns:
 *   1. Config    — persisted connection (token/base URL) in ~/.manimate/config.json
 *   2. Policy    — auth-failure detection and retry rules
 *   3. Connect   — device-code connect flow against the hosted server
 *   4. Sync      — fire-and-forget mirror of a session snapshot after a render
 *
 * Each sync uploads the full session snapshot — request presigned upload
 * URLs, PUT files straight to storage, POST the snapshot JSON to finalize —
 * so a retry at any time converges to the correct remote state. The hosted
 * server must support POST /api/local-sync/uploads (presigned plan); the
 * legacy multipart fallback was removed.
 */

import os from "node:os";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  DEFAULT_CLOUD_SYNC_BASE_URL,
  type CloudAuthStatus,
} from "@/lib/studio-cloud-auth";
import { getLocalSessionPaths } from "@/lib/local/config";
import {
  isRecord,
  readStoredLocalConfig,
  updateStoredLocalConfig,
} from "@/lib/local/local-config-store";
import {
  getLocalSession,
  listLocalMessages,
  listLocalRuns,
  readLocalSessionArtifacts,
  updateLocalSession,
} from "@/lib/local/session-store";
import { generateThumbnail, getExistingThumbnailPath } from "@/lib/local/thumbnail";

// ---------------------------------------------------------------------------
// Base URL normalization
// ---------------------------------------------------------------------------

export function normalizeCloudSyncBaseUrl(
  baseUrl: string | null | undefined,
  fallback?: string | null,
): string {
  const trimmed = baseUrl?.trim() || fallback?.trim() || "";
  const normalized = trimmed.replace(/\/+$/, "");
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "https:" && parsed.hostname.trim().toLowerCase() === "manimate.ai") {
      parsed.hostname = "www.manimate.ai";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

// ---------------------------------------------------------------------------
// Persisted connection config (~/.manimate/config.json)
// ---------------------------------------------------------------------------

export interface LocalCloudSyncConfig {
  base_url: string;
  token: string;
  connected_at: string;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  device_name?: string | null;
}

export interface LocalCloudSyncPendingConnect {
  base_url: string;
  request_id: string;
  poll_token: string;
  code: string;
  connect_url: string;
  device_name?: string | null;
  started_at: string;
  expires_at: string;
}

interface StoredLocalConfig {
  cloud_sync?: LocalCloudSyncConfig;
  cloud_sync_pending?: LocalCloudSyncPendingConnect;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function shouldIgnoreStoredCloudSyncConfig(config: LocalCloudSyncConfig): boolean {
  try {
    return isLoopbackHost(new URL(config.base_url).hostname);
  } catch {
    return false;
  }
}

function parseLocalCloudSyncConfig(value: unknown): LocalCloudSyncConfig | null {
  if (!isRecord(value)) return null;

  const baseUrl = typeof value.base_url === "string" ? value.base_url.trim() : "";
  const token = typeof value.token === "string" ? value.token.trim() : "";
  const connectedAt = typeof value.connected_at === "string" ? value.connected_at : "";
  if (!baseUrl || !token || !connectedAt) return null;

  return {
    base_url: normalizeCloudSyncBaseUrl(baseUrl),
    token,
    connected_at: connectedAt,
    user_id: typeof value.user_id === "string" ? value.user_id : null,
    user_email: typeof value.user_email === "string" ? value.user_email : null,
    user_name: typeof value.user_name === "string" ? value.user_name : null,
    device_name: typeof value.device_name === "string" ? value.device_name : null,
  };
}

function parseLocalCloudSyncPendingConnect(value: unknown): LocalCloudSyncPendingConnect | null {
  if (!isRecord(value)) return null;

  const baseUrl = typeof value.base_url === "string" ? value.base_url.trim() : "";
  const requestId = typeof value.request_id === "string" ? value.request_id.trim() : "";
  const pollToken = typeof value.poll_token === "string" ? value.poll_token.trim() : "";
  const code = typeof value.code === "string" ? value.code.trim() : "";
  const connectUrl = typeof value.connect_url === "string" ? value.connect_url.trim() : "";
  const startedAt = typeof value.started_at === "string" ? value.started_at : "";
  const expiresAt = typeof value.expires_at === "string" ? value.expires_at : "";
  if (!baseUrl || !requestId || !pollToken || !code || !connectUrl || !startedAt || !expiresAt) {
    return null;
  }

  return {
    base_url: normalizeCloudSyncBaseUrl(baseUrl),
    request_id: requestId,
    poll_token: pollToken,
    code,
    connect_url: connectUrl,
    device_name: typeof value.device_name === "string" ? value.device_name : null,
    started_at: startedAt,
    expires_at: expiresAt,
  };
}

function readCloudSyncConfig(): StoredLocalConfig {
  return readStoredLocalConfig() as StoredLocalConfig;
}

export function getLocalCloudSyncConfig(): LocalCloudSyncConfig | null {
  const config = parseLocalCloudSyncConfig(readCloudSyncConfig().cloud_sync);
  if (!config) return null;

  // Persisted loopback cloud targets usually come from local development and
  // should not suppress the real hosted connect flow in installed builds.
  if (shouldIgnoreStoredCloudSyncConfig(config)) {
    updateStoredLocalConfig((current) => ({
      ...current,
      cloud_sync: undefined,
    }));
    return null;
  }

  return config;
}

export function getLocalCloudSyncEnvOverride(): LocalCloudSyncConfig | null {
  const baseUrl = process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "";
  const token = process.env.MANIMATE_CLOUD_SYNC_TOKEN?.trim() || "";
  if (!baseUrl || !token) return null;

  return {
    base_url: normalizeCloudSyncBaseUrl(baseUrl),
    token,
    connected_at: new Date(0).toISOString(),
    user_id: null,
    user_email: null,
    user_name: null,
    device_name: null,
  };
}

export function writeLocalCloudSyncConfig(config: LocalCloudSyncConfig): void {
  const normalizedConfig: LocalCloudSyncConfig = {
    ...config,
    base_url: normalizeCloudSyncBaseUrl(config.base_url),
  };
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync: normalizedConfig,
    cloud_sync_pending: undefined,
  }));
}

export function clearLocalCloudSyncConfig(): void {
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync: undefined,
  }));
}

export function getLocalCloudSyncPendingConnect(): LocalCloudSyncPendingConnect | null {
  return parseLocalCloudSyncPendingConnect(readCloudSyncConfig().cloud_sync_pending);
}

export function writeLocalCloudSyncPendingConnect(pending: LocalCloudSyncPendingConnect): void {
  const normalizedPending: LocalCloudSyncPendingConnect = {
    ...pending,
    base_url: normalizeCloudSyncBaseUrl(pending.base_url),
  };
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync_pending: normalizedPending,
  }));
}

export function clearLocalCloudSyncPendingConnect(): void {
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync_pending: undefined,
  }));
}

// ---------------------------------------------------------------------------
// Policy: auth-failure detection and retry rules
// ---------------------------------------------------------------------------

export const CLOUD_SYNC_AUTH_RECONNECT_MESSAGE =
  "Cloud sync authorization was rejected. Local work is still saved here. Reconnect only if autosync should resume.";

export function isCloudSyncAuthorizationError(
  message: string | null | undefined,
): boolean {
  const normalized = message?.trim().toLowerCase() || "";
  if (!normalized) return false;

  return (
    normalized.includes("unauthorized") ||
    normalized.includes("not authorized") ||
    normalized.includes("no longer authorized") ||
    normalized.includes("authorization was rejected")
  );
}

export function formatCloudSyncFailureMessage(
  message: string | null | undefined,
): string {
  if (isCloudSyncAuthorizationError(message)) {
    return CLOUD_SYNC_AUTH_RECONNECT_MESSAGE;
  }

  return message?.trim() || "Cloud sync failed";
}

export function shouldRetryCloudSyncSession(params: {
  cloudSyncStatus: string | null | undefined;
  cloudLastError: string | null | undefined;
}): boolean {
  if (
    params.cloudSyncStatus !== "idle" &&
    params.cloudSyncStatus !== "pending" &&
    params.cloudSyncStatus !== "syncing" &&
    params.cloudSyncStatus !== "failed"
  ) {
    return false;
  }

  if (
    params.cloudSyncStatus === "failed" &&
    isCloudSyncAuthorizationError(params.cloudLastError)
  ) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Connect flow: device-code auth against the hosted server
// ---------------------------------------------------------------------------

const configuredCloudSyncBaseUrl =
  process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || DEFAULT_CLOUD_SYNC_BASE_URL;

type ConnectStartResponse = {
  request_id: string;
  poll_token: string;
  code: string;
  device_name: string | null;
  expires_at: string;
  connect_path: string;
  connect_url: string;
  poll_url: string;
};

type ConnectPollResponse = {
  status: "pending" | "approved" | "expired";
  requestId: string;
  code: string;
  deviceName: string | null;
  expiresAt: string;
  approvedAt?: string | null;
  syncToken?: string;
  user?: {
    id: string;
    email: string | null;
    name: string | null;
  };
};

export type LocalCloudSyncStatus = CloudAuthStatus;

export function getDefaultCloudSyncBaseUrl(): string {
  return normalizeBaseUrl();
}

function normalizeBaseUrl(baseUrl?: string | null): string {
  return normalizeCloudSyncBaseUrl(baseUrl, configuredCloudSyncBaseUrl);
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExpired(expiresAt: string): boolean {
  const expiresMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= Date.now();
}

async function hostedFetchJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function startHostedCloudSyncConnect(input?: {
  baseUrl?: string | null;
  deviceName?: string | null;
}): Promise<LocalCloudSyncPendingConnect> {
  const baseUrl = normalizeBaseUrl(input?.baseUrl);
  const response = await hostedFetchJson<ConnectStartResponse>(`${baseUrl}/api/local-sync/connect/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_name: input?.deviceName || os.hostname(),
    }),
  });

  return {
    base_url: baseUrl,
    request_id: response.request_id,
    poll_token: response.poll_token,
    code: response.code,
    connect_url: response.connect_url,
    device_name: response.device_name,
    started_at: new Date().toISOString(),
    expires_at: response.expires_at,
  };
}

export async function pollHostedCloudSyncConnect(
  pending: LocalCloudSyncPendingConnect
): Promise<ConnectPollResponse> {
  const baseUrl = normalizeBaseUrl(pending.base_url);
  return hostedFetchJson<ConnectPollResponse>(
    `${baseUrl}/api/local-sync/connect/poll?request_id=${encodeURIComponent(pending.request_id)}&poll_token=${encodeURIComponent(pending.poll_token)}`
  );
}

export function openExternalBrowser(url: string): boolean {
  const command: [string, string[]] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];

  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function mapConnectedStatus(config: LocalCloudSyncConfig): LocalCloudSyncStatus {
  return {
    status: "connected",
    base_url: normalizeBaseUrl(config.base_url),
    user_email: config.user_email ?? null,
    user_name: config.user_name ?? null,
    device_name: config.device_name ?? null,
    connected_at: config.connected_at,
  };
}

export function mapPendingStatus(pending: LocalCloudSyncPendingConnect): LocalCloudSyncStatus {
  return {
    status: "pending",
    base_url: normalizeBaseUrl(pending.base_url),
    code: pending.code,
    connect_url: pending.connect_url,
    device_name: pending.device_name ?? null,
    expires_at: pending.expires_at,
  };
}

export function mapDisconnectedStatus(baseUrl = getDefaultCloudSyncBaseUrl()): LocalCloudSyncStatus {
  return {
    status: "disconnected",
    base_url: normalizeBaseUrl(baseUrl),
  };
}

export async function refreshPendingCloudSyncConnect(
  pending: LocalCloudSyncPendingConnect
): Promise<LocalCloudSyncStatus> {
  if (isExpired(pending.expires_at)) {
    clearLocalCloudSyncPendingConnect();
    return {
      status: "error",
      base_url: normalizeBaseUrl(pending.base_url),
      message: "Connection request expired. Retry to open manimate.ai again.",
      code: pending.code,
      connect_url: pending.connect_url,
      device_name: pending.device_name ?? null,
      expires_at: pending.expires_at,
    };
  }

  try {
    const result = await pollHostedCloudSyncConnect(pending);
    if (result.status === "approved" && typeof result.syncToken === "string") {
      const config: LocalCloudSyncConfig = {
        base_url: normalizeBaseUrl(pending.base_url),
        token: result.syncToken,
        connected_at: result.approvedAt || new Date().toISOString(),
        user_id: result.user?.id ?? null,
        user_email: result.user?.email ?? null,
        user_name: result.user?.name ?? null,
        device_name: result.deviceName ?? pending.device_name ?? null,
      };
      writeLocalCloudSyncConfig(config);
      return mapConnectedStatus(config);
    }

    if (result.status === "expired") {
      clearLocalCloudSyncPendingConnect();
      return {
        status: "error",
        base_url: normalizeBaseUrl(pending.base_url),
        message: "Connection request expired. Retry to open manimate.ai again.",
        code: pending.code,
        connect_url: pending.connect_url,
        device_name: pending.device_name ?? null,
        expires_at: pending.expires_at,
      };
    }

    return mapPendingStatus(pending);
  } catch (error) {
    return {
      status: "error",
      base_url: normalizeBaseUrl(pending.base_url),
      message: normalizeErrorMessage(error),
      code: pending.code,
      connect_url: pending.connect_url,
      device_name: pending.device_name ?? null,
      expires_at: pending.expires_at,
    };
  }
}

export async function getLocalCloudSyncStatus(): Promise<LocalCloudSyncStatus> {
  const envOverride = getLocalCloudSyncEnvOverride();
  if (envOverride) {
    return mapConnectedStatus(envOverride);
  }

  const config = getLocalCloudSyncConfig();
  if (config) {
    return mapConnectedStatus(config);
  }

  const pending = getLocalCloudSyncPendingConnect();
  if (pending) {
    return refreshPendingCloudSyncConnect(pending);
  }

  return mapDisconnectedStatus();
}

export async function beginLocalCloudSyncConnect(input?: {
  baseUrl?: string | null;
  deviceName?: string | null;
  reopen?: boolean;
}): Promise<LocalCloudSyncStatus & { browser_opened?: boolean }> {
  const pending = await startHostedCloudSyncConnect(input);
  writeLocalCloudSyncPendingConnect(pending);
  const browserOpened = input?.reopen === false ? false : openExternalBrowser(pending.connect_url);
  return {
    ...mapPendingStatus(pending),
    browser_opened: browserOpened,
  };
}

export async function beginOrResumeLocalCloudSyncConnect(input?: {
  baseUrl?: string | null;
  deviceName?: string | null;
  reopen?: boolean;
}): Promise<LocalCloudSyncStatus & { browser_opened?: boolean }> {
  const envOverride = getLocalCloudSyncEnvOverride();
  if (envOverride) {
    return mapConnectedStatus(envOverride);
  }

  const existingConfig = getLocalCloudSyncConfig();
  if (existingConfig) {
    return mapConnectedStatus(existingConfig);
  }

  const pending = getLocalCloudSyncPendingConnect();
  if (pending) {
    if (isExpired(pending.expires_at)) {
      clearLocalCloudSyncPendingConnect();
    } else {
      const refreshed = await refreshPendingCloudSyncConnect(pending);
      if (refreshed.status !== "pending") {
        return refreshed;
      }

      return {
        ...refreshed,
        browser_opened: input?.reopen === true ? openExternalBrowser(pending.connect_url) : false,
      };
    }
  }

  return beginLocalCloudSyncConnect(input);
}

// ---------------------------------------------------------------------------
// Session snapshot sync
// ---------------------------------------------------------------------------

type LocalSession = NonNullable<ReturnType<typeof getLocalSession>>;

type CloudSyncAttachment = {
  // field_name is unused since the multipart fallback was removed, but stays
  // part of the snapshot wire format the hosted server accepts.
  field_name: string;
  id: string;
  local_path: string;
  name: string;
  size?: number;
  type?: string;
};

type CloudSyncSnapshot = {
  version: 1;
  session: Omit<LocalSession, "session_number"> &
    Awaited<ReturnType<typeof readLocalSessionArtifacts>>;
  messages: ReturnType<typeof listLocalMessages>;
  runs: ReturnType<typeof listLocalRuns>;
  // Tool-level activity is no longer persisted locally (the raw CLI transcript
  // in <session>/transcripts/ is the trace record); the key stays for the
  // hosted server's wire format.
  activity_events: never[];
  attachments: CloudSyncAttachment[];
};

type UploadPlanFile = {
  storage_path: string;
  upload_url: string;
  headers: Record<string, string>;
};

type UploadPlanResponse = {
  session_id: string;
  target_user_id: string;
  attachments: Array<UploadPlanFile & { id: string; local_path: string; name: string }>;
  video: UploadPlanFile | null;
  thumbnail: UploadPlanFile | null;
};

type CloudSyncSettings = {
  baseUrl: string;
  token: string;
};

function hasCloudSyncEnvOverride(): boolean {
  return Boolean(
    process.env.MANIMATE_CLOUD_SYNC_URL?.trim() &&
    process.env.MANIMATE_CLOUD_SYNC_TOKEN?.trim()
  );
}

function getCloudSyncSettings(): CloudSyncSettings | null {
  const config = getLocalCloudSyncEnvOverride() || getLocalCloudSyncConfig();
  if (!config?.base_url || !config.token) return null;

  return {
    baseUrl: config.base_url,
    token: config.token,
  };
}

async function fileExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildAttachmentManifest(
  messages: ReturnType<typeof listLocalMessages>
): CloudSyncAttachment[] {
  const seenLocalPaths = new Set<string>();
  const manifest: CloudSyncAttachment[] = [];

  for (const message of messages) {
    // Shape written by chat.ts when the user attaches images to a message.
    const images = message.metadata?.images as
      | Array<{ id?: string; path?: string; name?: string; size?: number; type?: string }>
      | undefined;
    if (!Array.isArray(images)) continue;

    for (const image of images) {
      if (!image?.id || !image.path || !image.name || seenLocalPaths.has(image.path)) continue;
      seenLocalPaths.add(image.path);
      manifest.push({
        field_name: `attachment_${manifest.length}`,
        id: image.id,
        local_path: image.path,
        name: image.name,
        size: image.size,
        type: image.type,
      });
    }
  }

  return manifest;
}

function normalizeCloudMirrorVoiceId(voiceId: string | null): string | null {
  if (typeof voiceId !== "string") return null;
  const trimmed = voiceId.trim();
  return trimmed === "none" || /^[a-zA-Z0-9]{8,64}$/.test(trimmed) ? trimmed : null;
}

async function buildSnapshot(session: LocalSession): Promise<{
  snapshot: CloudSyncSnapshot;
  videoPath: string | null;
  thumbnailPath: string | null;
}> {
  const messages = listLocalMessages(session.id);

  const attachments: CloudSyncAttachment[] = [];
  for (const attachment of buildAttachmentManifest(messages)) {
    if (await fileExists(attachment.local_path)) attachments.push(attachment);
  }

  const cloudSession: CloudSyncSnapshot["session"] & { session_number?: number } = {
    ...session,
    // Artifact content lives in project files locally; the hosted mirror
    // still receives it inline (wire format v1).
    ...(await readLocalSessionArtifacts(session.id)),
    voice_id: normalizeCloudMirrorVoiceId(session.voice_id),
  };
  delete cloudSession.session_number;

  const { sessionRoot } = getLocalSessionPaths(session.id);
  const videoPath = (await fileExists(session.video_path)) ? session.video_path : null;

  // The post-render thumbnail job is fire-and-forget and may not have
  // finished (or run) yet — ensure our own input instead of ordering jobs.
  let thumbnailPath = getExistingThumbnailPath(sessionRoot);
  if (!thumbnailPath && videoPath) {
    await generateThumbnail(videoPath, sessionRoot);
    thumbnailPath = getExistingThumbnailPath(sessionRoot);
  }

  return {
    snapshot: {
      version: 1,
      session: cloudSession,
      messages,
      runs: listLocalRuns(session.id),
      activity_events: [],
      attachments,
    },
    videoPath,
    thumbnailPath,
  };
}

async function postJson<T>(
  settings: CloudSyncSettings,
  apiPath: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${settings.baseUrl}${apiPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

async function putFile(upload: UploadPlanFile, localPath: string): Promise<void> {
  const response = await fetch(upload.upload_url, {
    method: "PUT",
    headers: upload.headers,
    body: await fsp.readFile(localPath),
  });

  if (!response.ok) {
    throw new Error(`Upload failed: HTTP ${response.status}`);
  }
}

async function pushSnapshot(
  settings: CloudSyncSettings,
  snapshot: CloudSyncSnapshot,
  videoPath: string | null,
  thumbnailPath: string | null
): Promise<{ public_video_url?: string | null }> {
  const plan = await postJson<UploadPlanResponse>(settings, "/api/local-sync/uploads", {
    session_id: snapshot.session.id,
    attachments: snapshot.attachments.map(({ id, local_path, name, type }) => ({
      id,
      local_path,
      name,
      type,
    })),
    include_video: Boolean(videoPath),
    include_thumbnail: Boolean(thumbnailPath),
  });

  const planByLocalPath = new Map(plan.attachments.map((a) => [a.local_path, a]));
  for (const attachment of snapshot.attachments) {
    const upload = planByLocalPath.get(attachment.local_path);
    if (!upload) {
      throw new Error(`Upload plan is missing attachment ${attachment.name}`);
    }
    await putFile(upload, attachment.local_path);
  }

  if (videoPath) {
    if (!plan.video) throw new Error("Upload plan is missing video upload");
    await putFile(plan.video, videoPath);
  }

  if (thumbnailPath) {
    if (!plan.thumbnail) throw new Error("Upload plan is missing thumbnail upload");
    await putFile(plan.thumbnail, thumbnailPath);
  }

  return postJson(settings, "/api/local-sync/sessions", { snapshot });
}

export function queueLocalCloudSync(sessionId: string): void {
  if (!getCloudSyncSettings()) return;

  updateLocalSession(sessionId, {
    cloud_sync_status: "pending",
    cloud_last_error: null,
  });

  queueMicrotask(() => {
    void syncLocalSessionToCloud(sessionId);
  });
}

async function syncLocalSessionToCloud(sessionId: string): Promise<void> {
  const session = getLocalSession(sessionId);
  if (!session) return;

  updateLocalSession(sessionId, {
    cloud_sync_status: "syncing",
    cloud_last_error: null,
  });

  try {
    const settings = getCloudSyncSettings();
    if (!settings) {
      throw new Error("Cloud sync is not configured. Open Manimate to reconnect.");
    }

    const { snapshot, videoPath, thumbnailPath } = await buildSnapshot(session);
    const result = await pushSnapshot(settings, snapshot, videoPath, thumbnailPath);

    updateLocalSession(sessionId, {
      cloud_sync_status: "synced",
      cloud_last_synced_at: new Date().toISOString(),
      cloud_last_error: null,
      cloud_public_video_url:
        typeof result.public_video_url === "string"
          ? result.public_video_url
          : session.cloud_public_video_url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloud sync failed";
    if (isCloudSyncAuthorizationError(message) && !hasCloudSyncEnvOverride()) {
      clearLocalCloudSyncConfig();
    }
    updateLocalSession(sessionId, {
      cloud_sync_status: "failed",
      cloud_last_error: formatCloudSyncFailureMessage(message),
    });
  }
}
