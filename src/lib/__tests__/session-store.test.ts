import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

async function loadStore(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  vi.resetModules();
  return import("@/lib/local/session-store");
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }
  vi.resetModules();
});

describe("session-store", () => {
  it("persists a full session lifecycle to session.json and reads it back", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-store-"));

    try {
      let store = await loadStore(localRoot);

      const session = store.createLocalSession({
        model: "claude",
        aspect_ratio: "16:9",
        voice_id: "af_heart",
      });

      const messageId = store.insertLocalMessage({
        session_id: session.id,
        role: "user",
        content: "Animate a pendulum",
      });
      const run = store.createLocalRun({
        session_id: session.id,
        user_message_id: messageId,
      });
      expect(store.getLocalActiveRun(session.id)?.id).toBe(run.id);

      store.updateLocalRun(session.id, run.id, {
        status: "completed",
        finished_at: "2026-07-06T00:00:00.000Z",
      });
      expect(store.getLocalActiveRun(session.id)).toBeNull();

      store.insertLocalMessage({
        session_id: session.id,
        role: "assistant",
        content: "Done",
      });

      // Video path is stored relative to the session root for portability.
      const projectDir = path.join(localRoot, "sessions", session.id, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      const videoPath = path.join(projectDir, "video.mp4");
      fs.writeFileSync(videoPath, "fake video");
      store.updateLocalSession(session.id, {
        title: "Pendulum",
        video_path: videoPath,
        chapters: JSON.stringify([{ name: "Scene1", start: 0, duration: 5 }]),
      });

      const raw = JSON.parse(
        fs.readFileSync(
          path.join(localRoot, "sessions", session.id, "session.json"),
          "utf8"
        )
      );
      expect(raw.video.path).toBe(path.join("project", "video.mp4"));
      expect(raw.messages).toHaveLength(2);
      expect(raw.messages[0].run.status).toBe("completed");

      // A fresh module instance (fresh cache) must reconstruct the same view.
      store = await loadStore(localRoot);
      const reloaded = store.getLocalSession(session.id);
      expect(reloaded).toMatchObject({
        title: "Pendulum",
        video_path: videoPath,
        chapters: JSON.stringify([{ name: "Scene1", start: 0, duration: 5 }]),
      });
      expect(reloaded?.last_video_url).toContain("_v=");
      expect(store.listLocalMessages(session.id)).toHaveLength(2);
      expect(store.listLocalRuns(session.id)).toHaveLength(1);
      expect(store.listLocalSessionSummaries()).toHaveLength(1);
      expect(store.listLocalSessionSummaries()[0].has_video).toBe(true);
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it("preserves the saved session when a write stops partway through", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-store-atomic-"));
    try {
      const store = await loadStore(localRoot);
      const session = store.createLocalSession({ model: "claude" });
      const file = path.join(localRoot, "sessions", session.id, "session.json");
      const saved = fs.readFileSync(file, "utf8");
      const write = fs.writeFileSync;
      const interrupted = vi.spyOn(fs, "writeFileSync").mockImplementation((target, data) => {
        write(target, String(data).slice(0, 12));
        throw new Error("ENOSPC");
      });
      try {
        expect(() => store.updateLocalSession(session.id, { title: "Unsaved" })).toThrow("ENOSPC");
      } finally {
        interrupted.mockRestore();
      }
      expect(fs.readFileSync(file, "utf8")).toBe(saved);
      const reloaded = await loadStore(localRoot);
      expect(reloaded.getLocalSession(session.id)?.title).toBe(session.title);
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });

});
