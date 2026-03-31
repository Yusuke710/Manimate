import fs from "node:fs";
import path from "node:path";
import { LOCAL_ROOT, ensureLocalLayout } from "@/lib/local/config";

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

export const LOCAL_CONFIG_PATH = path.join(LOCAL_ROOT, "config.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocalCloudSyncConfig(value: unknown): LocalCloudSyncConfig | null {
  if (!isRecord(value)) return null;

  const baseUrl = typeof value.base_url === "string" ? value.base_url.trim() : "";
  const token = typeof value.token === "string" ? value.token.trim() : "";
  const connectedAt = typeof value.connected_at === "string" ? value.connected_at : "";
  if (!baseUrl || !token || !connectedAt) return null;

  return {
    base_url: baseUrl,
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
    base_url: baseUrl,
    request_id: requestId,
    poll_token: pollToken,
    code,
    connect_url: connectUrl,
    device_name: typeof value.device_name === "string" ? value.device_name : null,
    started_at: startedAt,
    expires_at: expiresAt,
  };
}

function readStoredLocalConfig(): StoredLocalConfig {
  try {
    const raw = fs.readFileSync(LOCAL_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as StoredLocalConfig) : {};
  } catch {
    return {};
  }
}

export function getLocalCloudSyncConfig(): LocalCloudSyncConfig | null {
  return parseLocalCloudSyncConfig(readStoredLocalConfig().cloud_sync);
}

export function getLocalCloudSyncEnvOverride(): LocalCloudSyncConfig | null {
  const baseUrl = process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "";
  const token = process.env.MANIMATE_CLOUD_SYNC_TOKEN?.trim() || "";
  if (!baseUrl || !token) return null;

  return {
    base_url: baseUrl,
    token,
    connected_at: new Date(0).toISOString(),
    user_id: null,
    user_email: null,
    user_name: null,
    device_name: null,
  };
}

export function writeLocalCloudSyncConfig(config: LocalCloudSyncConfig): void {
  ensureLocalLayout();
  const next: StoredLocalConfig = {
    ...readStoredLocalConfig(),
    cloud_sync: config,
    cloud_sync_pending: undefined,
  };
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function clearLocalCloudSyncConfig(): void {
  ensureLocalLayout();
  const current = readStoredLocalConfig();
  const next: StoredLocalConfig = {
    ...current,
    cloud_sync: undefined,
  };
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function getLocalCloudSyncPendingConnect(): LocalCloudSyncPendingConnect | null {
  return parseLocalCloudSyncPendingConnect(readStoredLocalConfig().cloud_sync_pending);
}

export function writeLocalCloudSyncPendingConnect(pending: LocalCloudSyncPendingConnect): void {
  ensureLocalLayout();
  const next: StoredLocalConfig = {
    ...readStoredLocalConfig(),
    cloud_sync_pending: pending,
  };
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function clearLocalCloudSyncPendingConnect(): void {
  ensureLocalLayout();
  const current = readStoredLocalConfig();
  const next: StoredLocalConfig = {
    ...current,
    cloud_sync_pending: undefined,
  };
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
