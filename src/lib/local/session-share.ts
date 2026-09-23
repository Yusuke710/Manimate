import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getLocalSessionPaths } from "./config";
import { readStoredLocalConfig, updateStoredLocalConfig } from "./local-config-store";
import { getLocalActiveRun, getLocalSession, listLocalMessages, listLocalRuns, readLocalSessionArtifacts } from "./session-store";

type Connection = { base_url: string; token: string };
type PendingConnection = { request_id: string; poll_token: string; connect_url: string; code: string; expires_at: string };
type Upload = { upload_url: string; headers: Record<string, string>; local_path?: string };
type ShareRecord = { url?: string; version?: string; error?: string | null };
const uploads = new Map<string, Promise<string>>();
const origin = "https://www.manimate.ai";

export class ShareError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

async function request<T>(url: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new ShareError(result.error || "Sharing failed", response.status);
  return result;
}

function connection(): Connection | undefined {
  const config = readStoredLocalConfig().cloud_sync as Connection | undefined;
  return config?.token ? { ...config, base_url: config.base_url.replace(/^https:\/\/manimate\.ai(?=\/|$)/, origin).replace(/\/$/, "") } : undefined;
}

// Reuse existing connections. New users connect only when they choose Share.
async function connect(): Promise<PendingConnection | null> {
  if (connection()) return null;
  let pending = readStoredLocalConfig().cloud_sync_pending as PendingConnection | undefined;
  if (pending && Date.parse(pending.expires_at) > Date.now()) {
    const result = await request<{ status: string; syncToken?: string }>(`${origin}/api/local-sync/connect/poll?request_id=${encodeURIComponent(pending.request_id)}&poll_token=${encodeURIComponent(pending.poll_token)}`);
    if (result.status === "approved" && result.syncToken) {
      updateStoredLocalConfig(config => ({ ...config, cloud_sync: { base_url: origin, token: result.syncToken, connected_at: new Date().toISOString() }, cloud_sync_pending: undefined }));
      return null;
    }
    if (result.status === "pending") return pending;
  }
  pending = await request<PendingConnection>(`${origin}/api/local-sync/connect/start`, { device_name: os.hostname() });
  updateStoredLocalConfig(config => ({ ...config, cloud_sync_pending: pending }));
  return pending;
}

function recordPath(id: string) { return path.join(getLocalSessionPaths(id).sessionRoot, "share.json"); }
async function readRecord(id: string): Promise<ShareRecord> {
  return JSON.parse(await fs.readFile(recordPath(id), "utf8").catch(() => "{}"));
}
async function saveRecord(id: string, record: ShareRecord) {
  const file = recordPath(id);
  await fs.writeFile(file + ".tmp", JSON.stringify(record));
  await fs.rename(file + ".tmp", file);
}

async function uploadSession(id: string): Promise<string> {
  const session = getLocalSession(id);
  if (!session) throw new ShareError("Session not found", 404);
  if (getLocalActiveRun(id)) throw new ShareError("Wait for the render to finish before sharing.", 409);
  if (!session.video_path) throw new ShareError("Finish a render before sharing.", 409);
  const auth = connection();
  if (!auth) throw new ShareError("Connect to manimate.ai to share.", 401);
  const version = async () => {
    const { projectDir } = getLocalSessionPaths(id);
    const files = [session.video_path!, ...["script.py", "plan.md", "subtitles.srt"].map(name => path.join(projectDir, name))];
    return JSON.stringify([getLocalSession(id)?.updated_at, await Promise.all(files.map(async file => {
      const stat = await fs.stat(file).catch(() => null);
      return stat && [stat.size, stat.mtimeMs, stat.ctimeMs];
    }))]);
  };
  const before = await version();
  const record = await readRecord(id);
  if (record.url && record.version === before && !record.error) return record.url;
  const artifacts = await readLocalSessionArtifacts(id);
  const messages = listLocalMessages(id);
  const attachments = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const images = message.metadata?.images as Array<{ id: string; path: string; name: string; type?: string }> | undefined;
    for (const image of images || []) {
      if (!image.id || !image.path || seen.has(image.path)) continue;
      if (!await fs.stat(image.path).catch(() => null)) continue;
      seen.add(image.path);
      attachments.push({ field_name: `attachment_${attachments.length}`, id: image.id, local_path: image.path, name: image.name, type: image.type });
    }
  }
  const voice = session.voice_id;
  const snapshot = { version: 1, session: { ...session, ...artifacts, voice_id: voice === "none" || (voice && /^[a-zA-Z0-9]{8,64}$/.test(voice)) ? voice : null }, messages, runs: listLocalRuns(id), activity_events: [], attachments };
  const plan = await request<{ video: Upload; attachments: Upload[] }>(`${auth.base_url}/api/local-sync/uploads`, { session_id: id, attachments, include_video: true, include_thumbnail: false }, auth.token);
  for (const [upload, file] of [[plan.video, session.video_path], ...plan.attachments.map(item => [item, item.local_path] as const)] as Array<[Upload, string]>) {
    if (!upload?.upload_url || !file) throw new ShareError("Incomplete upload response");
    const response = await fetch(upload.upload_url, { method: "PUT", headers: upload.headers, body: await fs.readFile(file), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new ShareError(`Upload failed (${response.status})`);
  }
  if (getLocalActiveRun(id) || before !== await version()) throw new ShareError("The session changed while uploading. Share again after rendering finishes.", 409);
  await request(`${auth.base_url}/api/local-sync/sessions`, { snapshot }, auth.token);
  const link = await request<{ share_url: string }>(`${auth.base_url}/api/local-sync/sessions/${encodeURIComponent(id)}/share`, {}, auth.token);
  const url = new URL(link.share_url);
  if (url.origin !== new URL(auth.base_url).origin && url.origin !== "https://manimate.ai") throw new ShareError("Invalid share link");
  if (!/^\/share\/[\w-]+$/.test(url.pathname)) throw new ShareError("Invalid share link");
  await saveRecord(id, { url: url.href, version: before, error: null });
  return url.href;
}

// Check the current artifact version when each queued request starts.
function enqueue(id: string): Promise<string> {
  const upload = (uploads.get(id) || Promise.resolve()).catch(() => {}).then(() => uploadSession(id)).catch(async error => {
    await saveRecord(id, { ...await readRecord(id), error: error.message });
    if (error.status === 401) updateStoredLocalConfig(config => ({ ...config, cloud_sync: undefined }));
    throw error;
  });
  uploads.set(id, upload);
  void upload.finally(() => { if (uploads.get(id) === upload) uploads.delete(id); }).catch(() => {});
  return upload;
}

export async function shareSession(id: string) {
  if (!getLocalSession(id)) throw new ShareError("Session not found", 404);
  if (getLocalActiveRun(id)) throw new ShareError("Wait for the render to finish before sharing.", 409);
  const pending = await connect();
  if (pending) return { connect_url: pending.connect_url, code: pending.code };
  return { share_url: await enqueue(id) };
}

export async function refreshSharedSession(id: string): Promise<void> {
  const record = await readRecord(id);
  // Keep links made by earlier installed versions updating too.
  const legacy = JSON.parse(await fs.readFile(path.join(getLocalSessionPaths(id).sessionRoot, "session.json"), "utf8"));
  if (!record.url && !legacy.cloud?.public_video_url) return;
  await enqueue(id);
}
