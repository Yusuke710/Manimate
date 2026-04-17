import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queueLocalCloudSync,
  getLocalSession,
  getLocalCloudSyncConfig,
  getLocalCloudSyncEnvOverride,
} = vi.hoisted(() => ({
  queueLocalCloudSync: vi.fn(),
  getLocalSession: vi.fn(),
  getLocalCloudSyncConfig: vi.fn(),
  getLocalCloudSyncEnvOverride: vi.fn(),
}));

vi.mock("@/lib/local/cloud-sync", () => ({
  queueLocalCloudSync,
}));

vi.mock("@/lib/local/db", () => ({
  getLocalSession,
}));

vi.mock("@/lib/local/cloud-sync-config", () => ({
  getLocalCloudSyncConfig,
  getLocalCloudSyncEnvOverride,
}));

import {
  POST,
} from "./route";

function mockConnectedCloudConfig() {
  getLocalCloudSyncConfig.mockReturnValue({
    base_url: "https://manimate.ai",
    token: "msync_test_token",
    connected_at: "2026-04-17T00:00:00.000Z",
  });
}

function buildShareRequest() {
  return new NextRequest("http://localhost/api/sessions/session-1/share", {
    method: "POST",
  });
}

describe("POST /api/sessions/[sessionId]/share", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    queueLocalCloudSync.mockReset();
    getLocalSession.mockReset();
    getLocalCloudSyncConfig.mockReset();
    getLocalCloudSyncEnvOverride.mockReset();
    getLocalCloudSyncEnvOverride.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the hosted share URL for an already-synced session", async () => {
    mockConnectedCloudConfig();
    getLocalSession.mockReturnValue({
      id: "session-1",
      video_path: "/tmp/video.mp4",
      cloud_sync_status: "synced",
      cloud_last_synced_at: "2026-04-17T00:00:01.000Z",
      cloud_last_error: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      token: "OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      share_path: "/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      share_url: "https://manimate.ai/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const response = await POST(buildShareRequest(), {
      params: Promise.resolve({ sessionId: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      session_id: "session-1",
      token: "OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      share_path: "/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      share_url: "https://manimate.ai/share/OOJtY3C8nOr2WyGSa6OUtmopiPCL_Ugy",
      cloud_sync_status: "synced",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://manimate.ai/api/local-sync/sessions/session-1/share",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer msync_test_token",
        },
      },
    );
    expect(queueLocalCloudSync).not.toHaveBeenCalled();
  });

  it("rejects share requests before the first completed render sync", async () => {
    mockConnectedCloudConfig();
    getLocalSession.mockReturnValue({
      id: "session-1",
      video_path: null,
      cloud_sync_status: "idle",
      cloud_last_synced_at: null,
      cloud_last_error: null,
    });

    const response = await POST(buildShareRequest(), {
      params: Promise.resolve({ sessionId: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("Finish a render first");
    expect(queueLocalCloudSync).not.toHaveBeenCalled();
  });

  it("rejects hosted responses that try to return an app handoff link", async () => {
    mockConnectedCloudConfig();
    getLocalSession.mockReturnValue({
      id: "session-1",
      video_path: "/tmp/video.mp4",
      cloud_sync_status: "synced",
      cloud_last_synced_at: "2026-04-17T00:00:01.000Z",
      cloud_last_error: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      share_path: "/app?session=session-1",
      share_url: "https://manimate.ai/app?session=session-1",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const response = await POST(buildShareRequest(), {
      params: Promise.resolve({ sessionId: "session-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: "Hosted response did not return a canonical share link.",
    });
  });
});
