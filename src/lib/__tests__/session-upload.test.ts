import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
const run = vi.hoisted(() => vi.fn((_file: string, _args: unknown, _options: unknown, callback: (error: Error | null, result?: string) => void) => callback(null, '{}')));
vi.mock("node:child_process", async original => ({...await original<typeof import("node:child_process")>(), execFile: run}));
const roots: string[] = [];
async function setup(mode: "local" | "cloud") {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"manimate-upload-"));roots.push(root);
 vi.stubEnv("MANIMATE_LOCAL_ROOT",root);vi.stubEnv("MANIMATE_RENDER_MODE",mode);vi.resetModules();
 const store=await import("@/lib/local/session-store");
 const session=store.createLocalSession({model:"claude"});
 return {root,...store,session,...await import("@/lib/local/session-upload")};
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();run.mockReset();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it("never uploads local runs even if cloud is selected later",async()=>{
 const api=await setup("cloud");await api.uploadCloudSession(api.session.id,"local");expect(run).not.toHaveBeenCalled();
});
it("does not upload when the user switches to local",async()=>{
 const api=await setup("local");
 api.updateLocalSession(api.session.id,{video_path:"project/video.mp4",status:"completed"});
 await api.uploadCloudSession(api.session.id,"cloud");api.backupCloudLibrary();
 await new Promise(resolve => setImmediate(resolve));expect(run).not.toHaveBeenCalled();
});
it("automatically backs up videos, skips unchanged sessions and retries changed uploads", async () => {
  const api = await setup("cloud");
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  api.updateLocalSession(api.session.id, { video_path: "project/video.mp4", status: "completed" });
  const backup = () => JSON.parse(fs.readFileSync(path.join(api.root, "sessions", api.session.id, "cloud-backup.json"), "utf8"));
  api.backupCloudLibrary();
  await vi.waitFor(() => expect(backup().status).toBe("uploaded"));
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][0]).toBe("manim-cloud");

  now += 61_000;
  api.backupCloudLibrary();
  await new Promise(resolve => setImmediate(resolve));
  expect(run).toHaveBeenCalledOnce();

  const file = path.join(api.root, "sessions", api.session.id, "session.json");
  const session = JSON.parse(fs.readFileSync(file, "utf8"));
  session.updated_at = "2099-01-01T00:00:00Z";
  fs.writeFileSync(file, JSON.stringify(session));
  run.mockImplementationOnce((_f, _a, _o, cb) => cb(new Error("offline")));
  now += 61_000;
  api.backupCloudLibrary();
  await vi.waitFor(() => expect(backup().status).toBe("failed"));
  expect(run).toHaveBeenCalledTimes(2);

  now += 61_000;
  api.backupCloudLibrary();
  await vi.waitFor(() => expect(backup().status).toBe("uploaded"));
  expect(run).toHaveBeenCalledTimes(3);
  expect(backup().source_updated_at).toBe(session.updated_at);
});
