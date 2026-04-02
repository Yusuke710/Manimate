import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;
const AUTH_ERROR_MESSAGE = "Cloud sync is no longer authorized. Reopen Manimate to reconnect.";

async function loadDbModule(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  vi.resetModules();
  return import("@/lib/local/db");
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }
  vi.resetModules();
});

describe("listLocalCloudSyncRetryCandidates", () => {
  it("can include auth-blocked sessions during an explicit reconnect retry", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-retry-"));

    try {
      const db = await loadDbModule(localRoot);

      const idle = db.createLocalSession({ model: "opus" });
      db.updateLocalSession(idle.id, {
        video_path: "/tmp/idle.mp4",
        cloud_sync_status: "idle",
      });

      const authFailed = db.createLocalSession({ model: "opus" });
      db.updateLocalSession(authFailed.id, {
        video_path: "/tmp/auth-failed.mp4",
        cloud_sync_status: "failed",
        cloud_last_error: AUTH_ERROR_MESSAGE,
      });

      const synced = db.createLocalSession({ model: "opus" });
      db.updateLocalSession(synced.id, {
        video_path: "/tmp/synced.mp4",
        cloud_sync_status: "synced",
      });

      const defaultRetryIds = db
        .listLocalCloudSyncRetryCandidates()
        .map((session) => session.id)
        .sort();
      const reconnectRetryIds = db
        .listLocalCloudSyncRetryCandidates({ includeAuthFailures: true })
        .map((session) => session.id)
        .sort();

      expect(defaultRetryIds).toEqual([idle.id].sort());
      expect(reconnectRetryIds).toEqual([idle.id, authFailed.id].sort());
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
