import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getLocalSessionPaths, selectedRenderMode } from "./config";
import { getLocalSession, listLocalSessions } from "./session-store";

const execute = promisify(execFile);
const pending = new Map<string, Promise<void>>();
let queue = Promise.resolve();
let lastScan = 0;

export function uploadCloudSession(sessionId: string, runMode: "local" | "cloud" | null): Promise<void> {
  if (runMode !== "cloud" || selectedRenderMode() !== "cloud") return Promise.resolve();
  const previous = pending.get(sessionId);
  if (previous) return previous;
  const upload = queue.then(async () => {
    const session = getLocalSession(sessionId);
    if (selectedRenderMode() !== "cloud" || !session || ["running", "queued"].includes(session.status)) return;
    const root = getLocalSessionPaths(sessionId).sessionRoot;
    const record = (data: object) => fs.writeFileSync(path.join(root, "cloud-backup.json"), JSON.stringify(data));
    const sourceUpdatedAt = session.updated_at;
    record({status: "uploading"});
    try {
      await execute("manim-cloud", ["upload-session", root], {timeout: 240000, maxBuffer: 16384});
      record({status: "uploaded", source_updated_at: sourceUpdatedAt, uploaded_at: new Date().toISOString()});
    } catch {
      record({status: "failed", error: "Library backup failed. Local files are safe; automatic backup will retry."});
    }
  }).catch(() => {
    // A session can be deleted while its background backup is running.
  }).finally(() => {if (pending.get(sessionId) === upload) pending.delete(sessionId);});
  pending.set(sessionId, upload);
  queue = upload;
  return upload;
}

/** Back up this machine's library in the background; never download other machines' sessions. */
export function backupCloudLibrary(): void {
  if (selectedRenderMode() !== "cloud" || Date.now() - lastScan < 60_000) return;
  lastScan = Date.now();
  for (const session of listLocalSessions()) {
    if (!session.video_path || ["running", "queued"].includes(session.status)) continue;
    try {
      const backup = JSON.parse(fs.readFileSync(path.join(getLocalSessionPaths(session.id).sessionRoot, "cloud-backup.json"), "utf8"));
      if (backup.status === "uploaded" && backup.source_updated_at === session.updated_at) continue;
    } catch { /* No successful backup yet. */ }
    void uploadCloudSession(session.id, "cloud");
  }
}
