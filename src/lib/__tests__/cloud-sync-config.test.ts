import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

async function loadCloudSyncModules(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  vi.resetModules();

  const store = await import("@/lib/local/local-config-store");
  const config = await import("@/lib/local/cloud-sync-config");

  return { store, config };
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }
  vi.resetModules();
});

describe("getLocalCloudSyncConfig", () => {
  it("returns hosted cloud sync config as-is", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-"));
    try {
      const { store, config } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
          user_email: "user@example.com",
        },
      });

      expect(config.getLocalCloudSyncConfig()).toMatchObject({
        base_url: "https://manimate.ai",
        token: "token-123",
        connected_at: "2026-04-01T00:00:00.000Z",
        user_email: "user@example.com",
      });
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it("clears persisted loopback cloud sync config and preserves other settings", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-"));
    try {
      const { store, config } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "http://localhost:3000",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
        },
        elevenlabs_api_key: "secret-key",
      });

      expect(config.getLocalCloudSyncConfig()).toBeNull();
      expect(store.readStoredLocalConfig()).toEqual({
        elevenlabs_api_key: "secret-key",
      });
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
