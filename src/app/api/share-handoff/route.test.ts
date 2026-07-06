import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateHandoffFromSharedSnapshot = vi.fn();

vi.mock("@/lib/local/cloud-sync", () => ({
  getDefaultCloudSyncBaseUrl: () => "https://www.manimate.ai",
}));

vi.mock("@/lib/local/handoff", () => ({
  createHandoffFromSharedSnapshot: (...args: unknown[]) => mockCreateHandoffFromSharedSnapshot(...args),
}));

import { POST } from "./route";

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://127.0.0.1:32179/api/share-handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/share-handoff", () => {
  beforeEach(() => {
    mockCreateHandoffFromSharedSnapshot.mockReset();
    mockCreateHandoffFromSharedSnapshot.mockResolvedValue({
      session: { id: "local-session-1" },
      included: { plan: true, code: true, video: true, chapters: true },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      token: "abc123_DEF456ghi789",
      title: "Shared animation",
      planContent: "# Plan",
      scriptContent: "from manim import *",
      videoUrl: "https://cdn.example/video.mp4",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  it("loads a hosted shared snapshot and creates a local handoff session", async () => {
    const response = await POST(buildRequest({ token: "abc123_DEF456ghi789" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://www.manimate.ai/api/share/abc123_DEF456ghi789/handoff",
      { cache: "no-store" },
    );
    expect(mockCreateHandoffFromSharedSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "abc123_DEF456ghi789",
        planContent: "# Plan",
        scriptContent: "from manim import *",
        videoUrl: "https://cdn.example/video.mp4",
      }),
    );
    expect(payload.session.id).toBe("local-session-1");
  });

  it("rejects missing or invalid share tokens", async () => {
    const response = await POST(buildRequest({ token: "bad" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Missing or invalid share token");
    expect(mockCreateHandoffFromSharedSnapshot).not.toHaveBeenCalled();
  });
});
