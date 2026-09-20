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
afterEach(()=>{vi.unstubAllEnvs();run.mockClear();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it("never uploads local runs even if cloud is selected later",async()=>{
 const api=await setup("cloud");await api.uploadCloudSession(api.session.id,"local");expect(run).not.toHaveBeenCalled();
});
it("does not upload when the user switches to local",async()=>{
 const api=await setup("local");await api.uploadCloudSession(api.session.id,"cloud");expect(run).not.toHaveBeenCalled();
});
it("backs up completed cloud sessions using the authenticated CLI",async()=>{
 const api=await setup("cloud");await api.uploadCloudSession(api.session.id,"cloud");
 expect(run).toHaveBeenCalledOnce();expect(run.mock.calls[0][0]).toBe("manim-cloud");
 expect(JSON.parse(fs.readFileSync(path.join(api.root,"sessions",api.session.id,"cloud-backup.json"),"utf8")).status).toBe("uploaded");
 expect(api.getLocalSession(api.session.id)?.cloud_sync_status).toBe("idle");
});
it("records upload failures without failing the completed render",async()=>{
 const api=await setup("cloud");run.mockImplementationOnce((_f,_a,_o,cb)=>cb(new Error("offline")));
 await expect(api.uploadCloudSession(api.session.id,"cloud")).resolves.toBeUndefined();
 expect(JSON.parse(fs.readFileSync(path.join(api.root,"sessions",api.session.id,"cloud-backup.json"),"utf8")).status).toBe("failed");
});
it("automatically backs up existing library videos but skips unchanged backups",async()=>{
 const api=await setup("cloud");
 api.updateLocalSession(api.session.id,{video_path:"project/video.mp4",status:"completed"});
 api.backupCloudLibrary();
 await api.uploadCloudSession(api.session.id,"cloud");
 expect(run).toHaveBeenCalledOnce();
 const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+61_000);
 try {api.backupCloudLibrary();await Promise.resolve();expect(run).toHaveBeenCalledOnce();}
 finally {clock.mockRestore();}
});
it("library backup is off in local mode",async()=>{
 const api=await setup("local");
 api.updateLocalSession(api.session.id,{video_path:"project/video.mp4",status:"completed"});
 api.backupCloudLibrary();await Promise.resolve();expect(run).not.toHaveBeenCalled();
});
it("retries failed backups automatically on a later scan",async()=>{
 const api=await setup("cloud");
 api.updateLocalSession(api.session.id,{video_path:"project/video.mp4",status:"completed"});
 run.mockImplementationOnce((_f,_a,_o,cb)=>cb(new Error("offline")));
 api.backupCloudLibrary();await api.uploadCloudSession(api.session.id,"cloud");
 const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+61_000);
 try {api.backupCloudLibrary();await api.uploadCloudSession(api.session.id,"cloud");expect(run).toHaveBeenCalledTimes(2);}
 finally {clock.mockRestore();}
});
it("uploads a changed library session again",async()=>{
 const api=await setup("cloud");
 api.updateLocalSession(api.session.id,{video_path:"project/video.mp4",status:"completed"});
 api.backupCloudLibrary();await api.uploadCloudSession(api.session.id,"cloud");
 const file=path.join(api.root,"sessions",api.session.id,"session.json");
 const session=JSON.parse(fs.readFileSync(file,"utf8"));session.updated_at="2099-01-01T00:00:00Z";fs.writeFileSync(file,JSON.stringify(session));
 const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+61_000);
 try {api.backupCloudLibrary();await api.uploadCloudSession(api.session.id,"cloud");expect(run).toHaveBeenCalledTimes(2);}
 finally {clock.mockRestore();}
});
