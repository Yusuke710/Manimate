import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

async function loadModules(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  vi.resetModules();

  const db = await import("@/lib/local/session-store");
  const sessionsRoute = await import("@/app/api/sessions/route");

  return { db, sessionsRoute };
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }

  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /api/sessions", () => {
  it("returns the lightweight session list without filesystem video checks", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-session-list-"));

    try {
      const { db, sessionsRoute } = await loadModules(localRoot);

      const session = db.createLocalSession({ model: "claude" });
      db.updateLocalSession(session.id, {
        title: "A compact sidebar row",
        video_path: path.join(localRoot, "missing-video.mp4"),
      });

      const response = await sessionsRoute.GET(
        new NextRequest("http://localhost/api/sessions")
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toHaveLength(1);
      expect(payload[0]).toMatchObject({
        id: session.id,
        session_number: 1,
        title: "A compact sidebar row",
        status: "active",
      });
      expect(payload[0]).toHaveProperty("updated_at");
      expect(payload[0]).toHaveProperty("has_video", true);
      expect(payload[0]).not.toHaveProperty("plan_content");
      expect(payload[0]).not.toHaveProperty("script_content");
      expect(payload[0]).not.toHaveProperty("video_path");
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
