import fsp from "node:fs/promises";
import path from "node:path";
import { getLocalSessionPaths } from "@/lib/local/config";
import { clearLocalCloudSyncConfig, getLocalCloudSyncConfig } from "@/lib/local/cloud-sync-config";
import {
  getLocalSession,
  listLocalActivityEvents,
  listLocalMessages,
  listLocalRuns,
  updateLocalSession,
} from "@/lib/local/db";
import { ensureThumbnail } from "@/lib/local/thumbnail";

type CloudSyncAttachment = {
  field_name: string;
  id: string;
  local_path: string;
  name: string;
  size?: number;
  type?: string;
};

type CloudSyncPayload = {
  version: 1;
  activity_events: ReturnType<typeof listLocalActivityEvents>;
  attachments: CloudSyncAttachment[];
  messages: ReturnType<typeof listLocalMessages>;
  runs: ReturnType<typeof listLocalRuns>;
  session: NonNullable<ReturnType<typeof getLocalSession>>;
};

type CloudSyncSettings = {
  baseUrl: string;
  token: string;
};

function getCloudSyncSettings(): CloudSyncSettings | null {
  const envBaseUrl = process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "";
  const envToken = process.env.MANIMATE_CLOUD_SYNC_TOKEN?.trim() || "";
  if (envBaseUrl && envToken) {
    return {
      baseUrl: envBaseUrl.replace(/\/+$/, ""),
      token: envToken,
    };
  }

  const stored = getLocalCloudSyncConfig();
  if (!stored?.base_url || !stored.token) return null;

  return {
    baseUrl: stored.base_url.replace(/\/+$/, ""),
    token: stored.token,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferContentType(fileName: string, fallback = "application/octet-stream"): string {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".mp4")) return "video/mp4";
  return fallback;
}

async function appendFileIfPresent(
  formData: FormData,
  fieldName: string,
  filePath: string | null | undefined,
  contentType: string,
  fileName?: string
): Promise<boolean> {
  if (!filePath) return false;

  try {
    const buffer = await fsp.readFile(filePath);
    formData.append(
      fieldName,
      new Blob([buffer], { type: contentType }),
      fileName || path.basename(filePath)
    );
    return true;
  } catch {
    return false;
  }
}

function buildAttachmentManifest(messages: ReturnType<typeof listLocalMessages>): CloudSyncAttachment[] {
  const seenLocalPaths = new Set<string>();
  const manifest: CloudSyncAttachment[] = [];

  for (const message of messages) {
    const metadata = message.metadata;
    if (!isRecord(metadata) || !Array.isArray(metadata.images)) continue;

    for (const rawImage of metadata.images) {
      if (!isRecord(rawImage)) continue;
      const id = typeof rawImage.id === "string" ? rawImage.id : "";
      const localPath = typeof rawImage.path === "string" ? rawImage.path : "";
      const name = typeof rawImage.name === "string" ? rawImage.name : "";
      if (!id || !localPath || !name || seenLocalPaths.has(localPath)) continue;

      const fieldName = `attachment_${manifest.length}`;
      manifest.push({
        field_name: fieldName,
        id,
        local_path: localPath,
        name,
        size: typeof rawImage.size === "number" ? rawImage.size : undefined,
        type: typeof rawImage.type === "string" ? rawImage.type : undefined,
      });
      seenLocalPaths.add(localPath);
    }
  }

  return manifest;
}

async function buildSessionSnapshotFormData(
  payload: Omit<CloudSyncPayload, "attachments" | "version">
): Promise<FormData> {
  const formData = new FormData();
  const attachmentManifest = buildAttachmentManifest(payload.messages);
  const uploadedAttachments: CloudSyncAttachment[] = [];

  for (const attachment of attachmentManifest) {
    const didAppend = await appendFileIfPresent(
      formData,
      attachment.field_name,
      attachment.local_path,
      attachment.type || inferContentType(attachment.name),
      attachment.name
    );
    if (didAppend) {
      uploadedAttachments.push(attachment);
    }
  }

  const { sessionRoot } = getLocalSessionPaths(payload.session.id);
  const thumbnailPath = await ensureThumbnail(sessionRoot, payload.session.video_path);

  await appendFileIfPresent(
    formData,
    "video",
    payload.session.video_path,
    "video/mp4",
    payload.session.video_path ? path.basename(payload.session.video_path) : "video.mp4"
  );
  await appendFileIfPresent(
    formData,
    "thumbnail",
    thumbnailPath,
    "image/jpeg",
    "thumbnail.jpg"
  );

  const snapshot: CloudSyncPayload = {
    version: 1,
    ...payload,
    attachments: uploadedAttachments,
  };

  formData.set("snapshot", JSON.stringify(snapshot));

  return formData;
}

async function postSessionSnapshot(payload: CloudSyncPayload): Promise<{
  public_video_url?: string | null;
}> {
  const settings = getCloudSyncSettings();
  if (!settings) {
    throw new Error("Cloud sync is not configured. Open Manimate to reconnect.");
  }
  const formData = await buildSessionSnapshotFormData(payload);
  const response = await fetch(`${settings.baseUrl}/api/local-sync/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as { public_video_url?: string | null };
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
    const result = await postSessionSnapshot({
      version: 1,
      session,
      messages: listLocalMessages(sessionId),
      runs: listLocalRuns(sessionId),
      activity_events: listLocalActivityEvents(sessionId),
      attachments: [],
    });

    updateLocalSession(sessionId, {
      cloud_sync_status: "synced",
      cloud_last_synced_at: new Date().toISOString(),
      cloud_last_error: null,
      cloud_public_video_url: typeof result.public_video_url === "string" ? result.public_video_url : session.cloud_public_video_url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloud sync failed";
    const unauthorized = message.includes("Unauthorized");
    if (unauthorized) {
      clearLocalCloudSyncConfig();
    }
    updateLocalSession(sessionId, {
      cloud_sync_status: "failed",
      cloud_last_error: unauthorized
        ? "Cloud sync is no longer authorized. Reopen Manimate to reconnect."
        : message,
    });
  }
}
