import {
  isRecord,
  readStoredLocalConfig,
  updateStoredLocalConfig,
} from "@/lib/local/local-config-store";

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
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync: config,
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
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync_pending: pending,
  }));
}

export function clearLocalCloudSyncPendingConnect(): void {
  updateStoredLocalConfig((current) => ({
    ...current,
    cloud_sync_pending: undefined,
  }));
}
