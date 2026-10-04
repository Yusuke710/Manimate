import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

it("serves MOV bytes and changes the export version when the file is replaced", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-mov-"));
  vi.stubEnv("MANIMATE_LOCAL_ROOT", root);
  vi.resetModules();
  try {
    const { createLocalSession } = await import("@/lib/local/session-store");
    const { GET, HEAD } = await import("./route");
    const session = createLocalSession({ model: "claude" });
    const file = path.join(root, "sessions", session.id, "project", "video.mov");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const request = () => new NextRequest(`http://localhost/api/files?session_id=${session.id}&path=video.mov`);
    expect((await HEAD(request())).status).toBe(404);
    fs.writeFileSync(file, "first");
    const before = (await HEAD(request())).headers.get("ETag");
    const response = await GET(request());
    expect(response.headers.get("Content-Type")).toBe("video/quicktime");
    expect(await response.text()).toBe("first");
    fs.writeFileSync(file + ".tmp", "other");
    fs.utimesSync(file + ".tmp", new Date(0), new Date(0));
    fs.renameSync(file + ".tmp", file);
    expect((await HEAD(request())).headers.get("ETag")).not.toBe(before);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
