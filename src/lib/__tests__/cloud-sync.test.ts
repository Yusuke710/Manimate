import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;
const ORIGINAL_CLOUD_SYNC_URL = process.env.MANIMATE_CLOUD_SYNC_URL;
const ORIGINAL_CLOUD_SYNC_TOKEN = process.env.MANIMATE_CLOUD_SYNC_TOKEN;
const AUTH_ERROR_MESSAGE =
  "Cloud sync authorization was rejected. Local work is still saved here. Reconnect only if autosync should resume.";

async function loadCloudSyncModules(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  delete process.env.MANIMATE_CLOUD_SYNC_URL;
  delete process.env.MANIMATE_CLOUD_SYNC_TOKEN;
  vi.resetModules();

  const store = await import("@/lib/local/local-config-store");
  const config = await import("@/lib/local/cloud-sync-config");
  const db = await import("@/lib/local/db");
  const cloudSync = await import("@/lib/local/cloud-sync");

  return { store, config, db, cloudSync };
}

async function waitForCloudSyncStatus(
  getStatus: () => string | null,
  expectedStatus: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (getStatus() === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for cloud sync status ${expectedStatus}`);
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }

  if (ORIGINAL_CLOUD_SYNC_URL === undefined) {
    delete process.env.MANIMATE_CLOUD_SYNC_URL;
  } else {
    process.env.MANIMATE_CLOUD_SYNC_URL = ORIGINAL_CLOUD_SYNC_URL;
  }

  if (ORIGINAL_CLOUD_SYNC_TOKEN === undefined) {
    delete process.env.MANIMATE_CLOUD_SYNC_TOKEN;
  } else {
    process.env.MANIMATE_CLOUD_SYNC_TOKEN = ORIGINAL_CLOUD_SYNC_TOKEN;
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("queueLocalCloudSync", () => {
  it("clears persisted cloud sync config after hosted auth rejection", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-"));

    try {
      const { store, config, db, cloudSync } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
        },
      });

      const session = db.createLocalSession({ model: "opus" });
      db.updateLocalSession(session.id, {
        video_path: "/tmp/missing-video.mp4",
      });

      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      cloudSync.queueLocalCloudSync(session.id);

      await waitForCloudSyncStatus(
        () => db.getLocalSession(session.id)?.cloud_sync_status ?? null,
        "failed",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(db.getLocalSession(session.id)).toMatchObject({
        cloud_sync_status: "failed",
        cloud_last_error: AUTH_ERROR_MESSAGE,
      });
      expect(config.getLocalCloudSyncConfig()).toBeNull();
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
