import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageMetadata from "../../../package.json";
import { getCloudSyncDisplayHost } from "@/lib/studio-cloud-auth";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;
const ORIGINAL_CLOUD_SYNC_URL = process.env.MANIMATE_CLOUD_SYNC_URL;
const ORIGINAL_CLOUD_SYNC_TOKEN = process.env.MANIMATE_CLOUD_SYNC_TOKEN;
const AUTH_ERROR_MESSAGE =
  "Cloud sync authorization was rejected. Local work is still saved here. Reconnect only if autosync should resume.";
const LEGACY_AUTH_ERROR_MESSAGE = "Cloud sync is no longer authorized. Reopen Manimate to reconnect.";

async function loadCloudSyncModules(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  delete process.env.MANIMATE_CLOUD_SYNC_URL;
  delete process.env.MANIMATE_CLOUD_SYNC_TOKEN;
  vi.resetModules();

  const store = await import("@/lib/local/local-config-store");
  const db = await import("@/lib/local/session-store");
  const cloudSync = await import("@/lib/local/cloud-sync");

  return { store, db, cloudSync };
}

async function withTempRoot<T>(
  prefix: string,
  run: (modules: Awaited<ReturnType<typeof loadCloudSyncModules>>) => Promise<T>,
): Promise<T> {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await run(await loadCloudSyncModules(localRoot));
  } finally {
    fs.rmSync(localRoot, { recursive: true, force: true });
  }
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

describe("normalizeCloudSyncBaseUrl", () => {
  it("canonicalizes the hosted apex domain to www for authenticated sync", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(cloudSync.normalizeCloudSyncBaseUrl("https://manimate.ai")).toBe("https://www.manimate.ai");
      expect(cloudSync.normalizeCloudSyncBaseUrl("https://manimate.ai/")).toBe("https://www.manimate.ai");
      expect(cloudSync.normalizeCloudSyncBaseUrl("https://www.manimate.ai")).toBe("https://www.manimate.ai");
    });
  });

  it("leaves non-hosted and loopback targets unchanged", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(cloudSync.normalizeCloudSyncBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
      expect(cloudSync.normalizeCloudSyncBaseUrl("https://example.com/base/")).toBe("https://example.com/base");
    });
  });
});

describe("getCloudSyncDisplayHost", () => {
  it("strips the www prefix from the displayed host label", () => {
    expect(getCloudSyncDisplayHost("https://www.manimate.ai")).toBe("manimate.ai");
    expect(getCloudSyncDisplayHost("https://manimate.ai")).toBe("manimate.ai");
  });
});

describe("cloud sync policy", () => {
  it("recognizes authorization failures from hosted sync", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(cloudSync.isCloudSyncAuthorizationError("Unauthorized")).toBe(true);
      expect(cloudSync.isCloudSyncAuthorizationError(LEGACY_AUTH_ERROR_MESSAGE)).toBe(true);
    });
  });

  it("keeps non-auth failures as-is", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(cloudSync.isCloudSyncAuthorizationError("HTTP 500")).toBe(false);
      expect(cloudSync.formatCloudSyncFailureMessage("HTTP 500")).toBe("HTTP 500");
    });
  });

  it("normalizes auth failures to a non-looping reconnect message", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(cloudSync.formatCloudSyncFailureMessage("Unauthorized")).toBe(
        cloudSync.CLOUD_SYNC_AUTH_RECONNECT_MESSAGE,
      );
    });
  });

  it("does not auto-retry failed sessions blocked by auth errors", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(
        cloudSync.shouldRetryCloudSyncSession({
          cloudSyncStatus: "failed",
          cloudLastError: LEGACY_AUTH_ERROR_MESSAGE,
        }),
      ).toBe(false);
    });
  });

  it("still retries normal pending and failed sync candidates", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ cloudSync }) => {
      expect(
        cloudSync.shouldRetryCloudSyncSession({
          cloudSyncStatus: "pending",
          cloudLastError: null,
        }),
      ).toBe(true);
      expect(
        cloudSync.shouldRetryCloudSyncSession({
          cloudSyncStatus: "failed",
          cloudLastError: "HTTP 500",
        }),
      ).toBe(true);
    });
  });
});

describe("getLocalCloudSyncConfig", () => {
  it("returns hosted cloud sync config using the canonical hosted origin", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ store, cloudSync }) => {
      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
          user_email: "user@example.com",
        },
      });

      expect(cloudSync.getLocalCloudSyncConfig()).toMatchObject({
        base_url: "https://www.manimate.ai",
        token: "token-123",
        connected_at: "2026-04-01T00:00:00.000Z",
        user_email: "user@example.com",
      });
    });
  });

  it("clears persisted loopback cloud sync config and preserves other settings", async () => {
    await withTempRoot("manimate-cloud-sync-", async ({ store, cloudSync }) => {
      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "http://localhost:3000",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
        },
        elevenlabs_api_key: "secret-key",
      });

      expect(cloudSync.getLocalCloudSyncConfig()).toBeNull();
      expect(store.readStoredLocalConfig()).toEqual({
        elevenlabs_api_key: "secret-key",
      });
    });
  });
});

describe("beginOrResumeLocalCloudSyncConnect", () => {
  it("promotes an approved pending request to a connected account", async () => {
    await withTempRoot("manimate-cloud-sync-connect-", async ({ store, cloudSync }) => {
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

      const result = await cloudSync.beginOrResumeLocalCloudSyncConnect({ reopen: false });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        status: "connected",
        base_url: "https://www.manimate.ai",
        user_email: "youfu1202mo@gmail.com",
        user_name: "Yusuke Miyashita",
        device_name: "Yusukes-Laptop.lan",
      });
      expect(cloudSync.getLocalCloudSyncConfig()).toMatchObject({
        base_url: "https://www.manimate.ai",
        token: "msync_token_123",
        user_id: "user-123",
        user_email: "youfu1202mo@gmail.com",
        user_name: "Yusuke Miyashita",
        device_name: "Yusukes-Laptop.lan",
      });
      expect(store.readStoredLocalConfig()).toEqual({
        cloud_sync: {
          base_url: "https://www.manimate.ai",
          token: "msync_token_123",
          connected_at: "2026-04-05T00:00:03.000Z",
          user_id: "user-123",
          user_email: "youfu1202mo@gmail.com",
          user_name: "Yusuke Miyashita",
          device_name: "Yusukes-Laptop.lan",
        },
      });
    });
  });

  it("starts a fresh connect request after an expired pending request", async () => {
    await withTempRoot("manimate-cloud-sync-connect-", async ({ store, cloudSync }) => {
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
        expect(String(input)).toBe("https://www.manimate.ai/api/local-sync/connect/start");
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

      const result = await cloudSync.beginOrResumeLocalCloudSyncConnect({
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
      expect(cloudSync.getLocalCloudSyncPendingConnect()).toMatchObject({
        request_id: "fresh-req",
        poll_token: "fresh-poll",
        code: "NEW1-CODE",
      });
    });
  });
});

describe("listLocalCloudSyncRetryCandidates", () => {
  it("can include auth-blocked sessions during an explicit reconnect retry", async () => {
    await withTempRoot("manimate-cloud-sync-retry-", async ({ db }) => {
      const idle = db.createLocalSession({ model: "claude" });
      db.updateLocalSession(idle.id, {
        video_path: "/tmp/idle.mp4",
        cloud_sync_status: "idle",
      });

      const syncing = db.createLocalSession({ model: "claude" });
      db.updateLocalSession(syncing.id, {
        video_path: "/tmp/syncing.mp4",
        cloud_sync_status: "syncing",
      });

      const authFailed = db.createLocalSession({ model: "claude" });
      db.updateLocalSession(authFailed.id, {
        video_path: "/tmp/auth-failed.mp4",
        cloud_sync_status: "failed",
        cloud_last_error: LEGACY_AUTH_ERROR_MESSAGE,
      });

      const synced = db.createLocalSession({ model: "claude" });
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

      expect(defaultRetryIds).toEqual([idle.id, syncing.id].sort());
      expect(reconnectRetryIds).toEqual([idle.id, syncing.id, authFailed.id].sort());
    });
  });
});

describe("queueLocalCloudSync", () => {
  it("omits local-only voice IDs from hosted cloud snapshots", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-"));

    try {
      const { store, db, cloudSync } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
        },
      });

      const session = db.createLocalSession({
        model: "claude",
        voice_id: "af_heart",
      });
      const sessionRoot = path.join(localRoot, "sessions", session.id);
      const projectDir = path.join(sessionRoot, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      const videoPath = path.join(projectDir, "video.mp4");
      fs.writeFileSync(videoPath, "not a real mp4");
      fs.writeFileSync(path.join(sessionRoot, "thumbnail.jpg"), "not a real jpg");
      db.updateLocalSession(session.id, {
        video_path: videoPath,
      });

      let capturedSnapshot: { session?: { voice_id?: unknown } } | null = null;
      const uploadedUrls: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://www.manimate.ai/api/local-sync/uploads") {
          return new Response(
            JSON.stringify({
              session_id: session.id,
              target_user_id: "user-1",
              attachments: [],
              video: {
                storage_path: "sessions/test/video.mp4",
                upload_url: "https://storage.test/video.mp4",
                headers: { "Content-Type": "video/mp4" },
              },
              thumbnail: {
                storage_path: "sessions/test/thumbnail.jpg",
                upload_url: "https://storage.test/thumbnail.jpg",
                headers: { "Content-Type": "image/jpeg" },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.startsWith("https://storage.test/")) {
          expect(init?.method).toBe("PUT");
          uploadedUrls.push(url);
          return new Response(null, { status: 200 });
        }

        if (url === "https://www.manimate.ai/api/local-sync/sessions") {
          const body = JSON.parse(String(init?.body)) as {
            snapshot?: { session?: { voice_id?: unknown } };
          };
          capturedSnapshot = body.snapshot ?? null;
          return new Response(JSON.stringify({ public_video_url: "https://manimate.ai/v/test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        throw new Error(`Unexpected fetch target: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      cloudSync.queueLocalCloudSync(session.id);

      await waitForCloudSyncStatus(
        () => db.getLocalSession(session.id)?.cloud_sync_status ?? null,
        "synced",
      );

      expect(uploadedUrls).toEqual([
        "https://storage.test/video.mp4",
        "https://storage.test/thumbnail.jpg",
      ]);
      expect(capturedSnapshot?.session?.voice_id).toBeNull();
      expect(db.getLocalSession(session.id)).toMatchObject({
        voice_id: "af_heart",
        cloud_sync_status: "synced",
        cloud_public_video_url: "https://manimate.ai/v/test",
      });
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it("clears persisted cloud sync config after hosted auth rejection", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-cloud-sync-"));

    try {
      const { store, db, cloudSync } = await loadCloudSyncModules(localRoot);

      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "token-123",
          connected_at: "2026-04-01T00:00:00.000Z",
        },
      });

      const session = db.createLocalSession({ model: "claude" });
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
      expect(cloudSync.getLocalCloudSyncConfig()).toBeNull();
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});

describe("GET /api/cloud-sync/status", () => {
  it("includes the current app version and build id in the local status response", async () => {
    const route = await import("@/app/api/cloud-sync/[...action]/route");
    const response = await route.GET(
      new NextRequest("http://localhost/api/cloud-sync/status"),
      { params: Promise.resolve({ action: ["status"] }) },
    );
    const data = await response.json();

    expect(response.headers.get("x-manimate-studio")).toBe("local");
    expect(data.version).toBe(packageMetadata.version);
    expect(data.build_id).toBe(route.APP_BUILD_ID);
    expect(typeof data.status).toBe("string");
  });
});
