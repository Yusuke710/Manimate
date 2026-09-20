import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
const processes = vi.hoisted(() => ({execFile: vi.fn(), spawn: vi.fn()}));
vi.mock("node:child_process", async original => ({...await original<typeof import("node:child_process")>(), ...processes}));
const roots: string[] = [];
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-render-connect-")); roots.push(root);
  vi.stubEnv("MANIMATE_LOCAL_ROOT", root); vi.stubEnv("MANIMATE_RENDER_MODE", ""); vi.resetModules();
  return {root, ...await import("@/lib/local/render-connection")};
}
afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true, force:true});});
it("rejects cross-origin connection requests before changing config or launching login", async () => {
  const api = await setup();
  const {POST} = await import("@/app/api/rendering/route");
  const response = await POST(new NextRequest("http://localhost:32179/api/rendering", {method:"POST",headers:{origin:"https://evil.example","content-type":"application/json"},body:JSON.stringify({mode:"cloud",action:"connect"})}));
  expect(response.status).toBe(403); expect((await api.renderConnection()).mode).toBeNull();
  expect(processes.execFile).not.toHaveBeenCalled();
  expect(processes.spawn).not.toHaveBeenCalled();
});
