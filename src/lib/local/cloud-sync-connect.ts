import os from "node:os";
import { spawn } from "node:child_process";
import {
  DEFAULT_CLOUD_SYNC_BASE_URL,
  type CloudAuthStatus,
} from "@/lib/studio-cloud-auth";
import {
  clearLocalCloudSyncPendingConnect,
  getLocalCloudSyncConfig,
  getLocalCloudSyncEnvOverride,
  getLocalCloudSyncPendingConnect,
  type LocalCloudSyncConfig,
  type LocalCloudSyncPendingConnect,
  writeLocalCloudSyncConfig,
  writeLocalCloudSyncPendingConnect,
} from "@/lib/local/cloud-sync-config";

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
  const trimmed = baseUrl?.trim() || configuredCloudSyncBaseUrl;
  return trimmed.replace(/\/+$/, "");
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
