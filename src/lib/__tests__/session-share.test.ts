import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const roots: string[] = [];
async function setup(connected = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-share-")); roots.push(root);
  vi.stubEnv("MANIMATE_LOCAL_ROOT", root); vi.resetModules();
  if (connected) fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ cloud_sync: { base_url: "https://manimate.ai", token: "test" } }));
  const store = await import("@/lib/local/session-store");
  const session = store.createLocalSession({ model: "claude" });
  const dir = path.join(root, "sessions", session.id, "project"); fs.mkdirSync(dir, { recursive: true });
  const video = path.join(dir, "video.mp4"); fs.writeFileSync(video, "old video");
  fs.writeFileSync(path.join(dir, "script.py"), "old code");
  store.updateLocalSession(session.id, { video_path: video });
  return { root, dir, video, id: session.id, ...store, ...await import("@/lib/local/session-share") };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("shares current artifacts and refreshes the same link after edits", async () => {
  const api = await setup(); const videos: string[] = []; const codes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    if (input.endsWith("/uploads")) return Response.json({ video: { upload_url: "https://storage.test/video", headers: {} }, attachments: [] });
    if (input === "https://storage.test/video") { videos.push(Buffer.from(init.body as Uint8Array).toString()); return new Response(null); }
    if (input.endsWith("/sessions")) { codes.push(JSON.parse(String(init.body)).snapshot.session.script_content); return Response.json({}); }
    if (input.endsWith("/share")) return Response.json({ share_url: "https://www.manimate.ai/share/test" });
    throw new Error(input);
  }));
  expect(await api.shareSession(api.id)).toEqual({ share_url: "https://www.manimate.ai/share/test" });
  expect(await api.shareSession(api.id)).toEqual({ share_url: "https://www.manimate.ai/share/test" });
  expect(videos).toEqual(["old video"]);
  fs.writeFileSync(api.video, "new 4K video"); fs.writeFileSync(path.join(api.dir, "script.py"), "new code");
  await api.refreshSharedSession(api.id);
  expect(videos).toEqual(["old video", "new 4K video"]); expect(codes).toEqual(["old code", "new code"]);
  expect(await api.shareSession(api.id)).toEqual({ share_url: "https://www.manimate.ai/share/test" });
  expect(videos).toHaveLength(2);
});

it("does not publish a running render or a snapshot changed during upload", async () => {
  const api = await setup();
  const message = api.insertLocalMessage({ session_id: api.id, role: "user", content: "render" });
  const run = api.createLocalRun({ session_id: api.id, user_message_id: message });
  await expect(api.shareSession(api.id)).rejects.toMatchObject({ status: 409 });
  api.updateLocalRun(api.id, run.id, { status: "completed" });
  const fetchMock = vi.fn(async (input: string) => {
    if (input.endsWith("/uploads")) return Response.json({ video: { upload_url: "https://storage.test/video", headers: {} }, attachments: [] });
    fs.writeFileSync(api.video, "changed during upload"); return new Response(null);
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.shareSession(api.id)).rejects.toMatchObject({ status: 409 });
  expect(fetchMock.mock.calls.map(call => call[0])).not.toContain("https://www.manimate.ai/api/local-sync/sessions");
});

it("offers connection without exposing the polling credential", async () => {
  const api = await setup(false);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ request_id: "request", poll_token: "private", code: "ABC", connect_url: "https://www.manimate.ai/connect/request", expires_at: "2099-01-01" })));
  expect(await api.shareSession(api.id)).toEqual({ connect_url: "https://www.manimate.ai/connect/request", code: "ABC" });
});
