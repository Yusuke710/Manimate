import fsp from "node:fs/promises";
import path from "node:path";
import { getLocalSessionPaths } from "@/lib/local/config";
import { normalizeCloudSyncBaseUrl } from "@/lib/local/cloud-sync-base-url";
import {
  clearLocalCloudSyncConfig,
  getLocalCloudSyncConfig,
} from "@/lib/local/cloud-sync-config";
import {
  formatCloudSyncFailureMessage,
  isCloudSyncAuthorizationError,
} from "@/lib/local/cloud-sync-policy";
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

type CloudSyncUploadPlanRequest = {
  session_id: string;
  attachments: Array<Pick<CloudSyncAttachment, "id" | "local_path" | "name" | "type">>;
  include_video: boolean;
  include_thumbnail: boolean;
};

type CloudSyncUploadPlanFile = {
  storage_path: string;
  upload_url: string;
  headers: Record<string, string>;
};

type CloudSyncUploadPlanAttachment = CloudSyncUploadPlanFile & {
  id: string;
  local_path: string;
  name: string;
};

type CloudSyncUploadPlanResponse = {
  session_id: string;
  target_user_id: string;
  attachments: CloudSyncUploadPlanAttachment[];
  video: CloudSyncUploadPlanFile | null;
  thumbnail: CloudSyncUploadPlanFile | null;
};

type PreparedUploadFile = {
  contentType: string;
  fileName: string;
  localPath: string;
};

type PreparedCloudSyncSnapshot = {
  snapshot: CloudSyncPayload;
  thumbnailFile: PreparedUploadFile | null;
  videoFile: PreparedUploadFile | null;
};

type CloudSyncSettings = {
  baseUrl: string;
  token: string;
};

const DIRECT_UPLOAD_UNSUPPORTED = "__MANIMATE_DIRECT_UPLOAD_UNSUPPORTED__";

function hasCloudSyncEnvOverride(): boolean {
  return Boolean(
    process.env.MANIMATE_CLOUD_SYNC_URL?.trim() &&
    process.env.MANIMATE_CLOUD_SYNC_TOKEN?.trim()
  );
}

function getCloudSyncSettings(): CloudSyncSettings | null {
  const envBaseUrl = process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "";
  const envToken = process.env.MANIMATE_CLOUD_SYNC_TOKEN?.trim() || "";
  if (envBaseUrl && envToken) {
    return {
      baseUrl: normalizeCloudSyncBaseUrl(envBaseUrl),
      token: envToken,
    };
  }

  const stored = getLocalCloudSyncConfig();
  if (!stored?.base_url || !stored.token) return null;

  return {
    baseUrl: normalizeCloudSyncBaseUrl(stored.base_url),
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

async function getReadableUploadFile(
  filePath: string | null | undefined,
  contentType: string,
  fileName?: string
): Promise<PreparedUploadFile | null> {
  if (!filePath) return null;

  try {
    await fsp.access(filePath);
    return {
      contentType,
      fileName: fileName || path.basename(filePath),
      localPath: filePath,
    };
  } catch {
    return null;
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

async function prepareSessionSnapshot(
  payload: Omit<CloudSyncPayload, "attachments" | "version">
): Promise<PreparedCloudSyncSnapshot> {
  const attachmentManifest = buildAttachmentManifest(payload.messages);
  const uploadedAttachments: CloudSyncAttachment[] = [];

  for (const attachment of attachmentManifest) {
    const prepared = await getReadableUploadFile(
      attachment.local_path,
      attachment.type || inferContentType(attachment.name),
      attachment.name
    );
    if (prepared) {
      uploadedAttachments.push(attachment);
    }
  }

  const { sessionRoot } = getLocalSessionPaths(payload.session.id);
  const thumbnailPath = await ensureThumbnail(sessionRoot, payload.session.video_path);

  return {
    snapshot: {
      version: 1,
      ...payload,
      attachments: uploadedAttachments,
    },
    videoFile: await getReadableUploadFile(
      payload.session.video_path,
      "video/mp4",
      payload.session.video_path ? path.basename(payload.session.video_path) : "video.mp4"
    ),
    thumbnailFile: await getReadableUploadFile(
      thumbnailPath,
      "image/jpeg",
      "thumbnail.jpg"
    ),
  };
}

async function buildMultipartSessionSnapshotFormData(
  prepared: PreparedCloudSyncSnapshot
): Promise<FormData> {
  const formData = new FormData();

  for (const attachment of prepared.snapshot.attachments) {
    await appendFileIfPresent(
      formData,
      attachment.field_name,
      attachment.local_path,
      attachment.type || inferContentType(attachment.name),
      attachment.name
    );
  }

  await appendFileIfPresent(
    formData,
    "video",
    prepared.videoFile?.localPath,
    prepared.videoFile?.contentType || "video/mp4",
    prepared.videoFile?.fileName || "video.mp4"
  );
  await appendFileIfPresent(
    formData,
    "thumbnail",
    prepared.thumbnailFile?.localPath,
    prepared.thumbnailFile?.contentType || "image/jpeg",
    prepared.thumbnailFile?.fileName || "thumbnail.jpg"
  );

  formData.set("snapshot", JSON.stringify(prepared.snapshot));
  return formData;
}

async function uploadFileToPresignedUrl(
  upload: CloudSyncUploadPlanFile,
  localFile: PreparedUploadFile
): Promise<void> {
  const body = await fsp.readFile(localFile.localPath);
  const response = await fetch(upload.upload_url, {
    method: "PUT",
    headers: upload.headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: HTTP ${response.status}`);
  }
}

async function requestUploadPlan(
  settings: CloudSyncSettings,
  prepared: PreparedCloudSyncSnapshot
): Promise<CloudSyncUploadPlanResponse> {
  const requestBody: CloudSyncUploadPlanRequest = {
    session_id: prepared.snapshot.session.id,
    attachments: prepared.snapshot.attachments.map((attachment) => ({
      id: attachment.id,
      local_path: attachment.local_path,
      name: attachment.name,
      type: attachment.type,
    })),
    include_video: Boolean(prepared.videoFile),
    include_thumbnail: Boolean(prepared.thumbnailFile),
  };
  const response = await fetch(`${settings.baseUrl}/api/local-sync/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error(DIRECT_UPLOAD_UNSUPPORTED);
    }
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as CloudSyncUploadPlanResponse;
}

async function uploadSnapshotFiles(
  prepared: PreparedCloudSyncSnapshot,
  plan: CloudSyncUploadPlanResponse
): Promise<void> {
  const attachmentPlanByLocalPath = new Map(
    plan.attachments.map((attachment) => [attachment.local_path, attachment])
  );

  for (const attachment of prepared.snapshot.attachments) {
    const upload = attachmentPlanByLocalPath.get(attachment.local_path);
    if (!upload) {
      throw new Error(`Upload plan is missing attachment ${attachment.name}`);
    }
    await uploadFileToPresignedUrl(upload, {
      contentType: attachment.type || inferContentType(attachment.name),
      fileName: attachment.name,
      localPath: attachment.local_path,
    });
  }

  if (prepared.videoFile) {
    if (!plan.video) {
      throw new Error("Upload plan is missing video upload");
    }
    await uploadFileToPresignedUrl(plan.video, prepared.videoFile);
  }

  if (prepared.thumbnailFile) {
    if (!plan.thumbnail) {
      throw new Error("Upload plan is missing thumbnail upload");
    }
    await uploadFileToPresignedUrl(plan.thumbnail, prepared.thumbnailFile);
  }
}

async function finalizeSessionSnapshot(
  settings: CloudSyncSettings,
  snapshot: CloudSyncPayload
): Promise<{
  public_video_url?: string | null;
}> {
  const response = await fetch(`${settings.baseUrl}/api/local-sync/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snapshot }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as { public_video_url?: string | null };
}

async function finalizeSessionSnapshotMultipart(
  settings: CloudSyncSettings,
  prepared: PreparedCloudSyncSnapshot
): Promise<{
  public_video_url?: string | null;
}> {
  const formData = await buildMultipartSessionSnapshotFormData(prepared);
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

async function postSessionSnapshot(payload: CloudSyncPayload): Promise<{
  public_video_url?: string | null;
}> {
  const settings = getCloudSyncSettings();
  if (!settings) {
    throw new Error("Cloud sync is not configured. Open Manimate to reconnect.");
  }

  const prepared = await prepareSessionSnapshot(payload);

  try {
    const plan = await requestUploadPlan(settings, prepared);
    await uploadSnapshotFiles(prepared, plan);
    return await finalizeSessionSnapshot(settings, prepared.snapshot);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== DIRECT_UPLOAD_UNSUPPORTED) {
      throw error;
    }
  }

  return finalizeSessionSnapshotMultipart(settings, prepared);
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
    if (isCloudSyncAuthorizationError(message) && !hasCloudSyncEnvOverride()) {
      clearLocalCloudSyncConfig();
    }
    updateLocalSession(sessionId, {
      cloud_sync_status: "failed",
      cloud_last_error: formatCloudSyncFailureMessage(message),
    });
  }
}
