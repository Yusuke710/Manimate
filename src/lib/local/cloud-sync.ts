/**
 * Cloud sync: fire-and-forget mirror of a session to hosted Manimate.
 *
 * Runs deterministically after a render (chat.ts) or on explicit retry.
 * Each sync uploads the full session snapshot — request presigned upload
 * URLs, PUT files straight to storage, POST the snapshot JSON to finalize —
 * so a retry at any time converges to the correct remote state.
 *
 * The hosted server must support POST /api/local-sync/uploads (presigned
 * plan); the legacy multipart fallback was removed.
 */

import fsp from "node:fs/promises";
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
  listLocalMessages,
  listLocalRuns,
  readLocalSessionArtifacts,
  updateLocalSession,
} from "@/lib/local/session-store";
import { generateThumbnail, getExistingThumbnailPath } from "@/lib/local/thumbnail";

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
    ReturnType<typeof readLocalSessionArtifacts>;
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
    ...readLocalSessionArtifacts(session.id),
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
