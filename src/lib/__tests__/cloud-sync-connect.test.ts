import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;
const ORIGINAL_CLOUD_SYNC_URL = process.env.MANIMATE_CLOUD_SYNC_URL;
const ORIGINAL_CLOUD_SYNC_TOKEN = process.env.MANIMATE_CLOUD_SYNC_TOKEN;

async function loadCloudSyncModules(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  delete process.env.MANIMATE_CLOUD_SYNC_URL;
  delete process.env.MANIMATE_CLOUD_SYNC_TOKEN;
  vi.resetModules();

  const store = await import("@/lib/local/local-config-store");
  const config = await import("@/lib/local/cloud-sync-config");
  const connect = await import("@/lib/local/cloud-sync-connect");

  return { store, config, connect };
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

describe("beginOrResumeLocalCloudSyncConnect", () => {
  it("promotes an approved pending request to a connected account", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-connect-"));

    try {
      const { store, config, connect } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync_pending: {
          base_url: "https://manimate.ai",
          request_id: "req-123",
          poll_token: "poll-123",
          code: "ABCD-EFGH",
          connect_url: "https://manimate.ai/connect/device/req-123",
          device_name: "Yusukes-Laptop.lan",
          started_at: "2026-04-05T00:00:00.000Z",
          expires_at: "2999-01-01T00:00:00.000Z",
        },
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain("/api/local-sync/connect/poll?");
        return new Response(JSON.stringify({
          status: "approved",
          requestId: "req-123",
          code: "ABCD-EFGH",
          deviceName: "Yusukes-Laptop.lan",
          expiresAt: "2999-01-01T00:00:00.000Z",
          approvedAt: "2026-04-05T00:00:03.000Z",
          syncToken: "msync_token_123",
          user: {
            id: "user-123",
            email: "youfu1202mo@gmail.com",
            name: "Yusuke Miyashita",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await connect.beginOrResumeLocalCloudSyncConnect({ reopen: false });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        status: "connected",
        base_url: "https://manimate.ai",
        user_email: "youfu1202mo@gmail.com",
        user_name: "Yusuke Miyashita",
        device_name: "Yusukes-Laptop.lan",
      });
      expect(config.getLocalCloudSyncConfig()).toMatchObject({
        base_url: "https://manimate.ai",
        token: "msync_token_123",
        user_id: "user-123",
        user_email: "youfu1202mo@gmail.com",
        user_name: "Yusuke Miyashita",
        device_name: "Yusukes-Laptop.lan",
      });
      expect(store.readStoredLocalConfig()).toEqual({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "msync_token_123",
          connected_at: "2026-04-05T00:00:03.000Z",
          user_id: "user-123",
          user_email: "youfu1202mo@gmail.com",
          user_name: "Yusuke Miyashita",
          device_name: "Yusukes-Laptop.lan",
        },
      });
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it("starts a fresh connect request after an expired pending request", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-connect-"));

    try {
      const { store, config, connect } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync_pending: {
          base_url: "https://manimate.ai",
          request_id: "expired-req",
          poll_token: "expired-poll",
          code: "OLD1-CODE",
          connect_url: "https://manimate.ai/connect/device/expired-req",
          device_name: "Yusukes-Laptop.lan",
          started_at: "2026-04-05T00:00:00.000Z",
          expires_at: "2000-01-01T00:00:00.000Z",
        },
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://manimate.ai/api/local-sync/connect/start");
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({
          request_id: "fresh-req",
          poll_token: "fresh-poll",
          code: "NEW1-CODE",
          device_name: "Yusukes-Laptop.lan",
          expires_at: "2999-01-01T00:00:00.000Z",
          connect_path: "/connect/device/fresh-req",
          connect_url: "https://manimate.ai/connect/device/fresh-req",
          poll_url: "https://manimate.ai/api/local-sync/connect/poll?request_id=fresh-req&poll_token=fresh-poll",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await connect.beginOrResumeLocalCloudSyncConnect({
        reopen: false,
        deviceName: "Yusukes-Laptop.lan",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        status: "pending",
        code: "NEW1-CODE",
        connect_url: "https://manimate.ai/connect/device/fresh-req",
        browser_opened: false,
      });
      expect(config.getLocalCloudSyncPendingConnect()).toMatchObject({
        request_id: "fresh-req",
        poll_token: "fresh-poll",
        code: "NEW1-CODE",
      });
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
