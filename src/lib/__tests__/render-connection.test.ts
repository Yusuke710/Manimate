import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
const roots: string[] = [];
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-render-connect-")); roots.push(root);
  vi.stubEnv("MANIMATE_LOCAL_ROOT", root); vi.stubEnv("MANIMATE_RENDER_MODE", ""); vi.resetModules();
  return {root, ...await import("@/lib/local/render-connection")};
}
afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true, force:true});});
it("starts with a choice and local rendering needs no cloud process or fetch", async () => {
  const api = await setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
  expect(await api.renderConnection()).toEqual({mode:null,status:"disconnected"});
  api.selectRenderMode("local");
  expect(await api.renderConnection()).toEqual({mode:"local",status:"ready"});
  expect(fetch).not.toHaveBeenCalled();
  await expect(api.connectRenderer()).rejects.toThrow("Choose cloud");
});
it("preserves other settings and respects an explicit environment override", async () => {
  const api = await setup();
  fs.writeFileSync(path.join(api.root,"config.json"), JSON.stringify({other:42}));
  api.selectRenderMode("cloud");
  expect(JSON.parse(fs.readFileSync(path.join(api.root,"config.json"),"utf8"))).toEqual({other:42,render_mode:"cloud"});
  vi.stubEnv("MANIMATE_RENDER_MODE","local");
  expect(() => api.selectRenderMode("cloud")).toThrow("MANIMATE_RENDER_MODE");
});
it("rejects cross-origin connection requests before changing config or launching login", async () => {
  const api = await setup();
  const {POST} = await import("@/app/api/rendering/route");
  const response = await POST(new NextRequest("http://localhost:32179/api/rendering", {method:"POST",headers:{origin:"https://evil.example","content-type":"application/json"},body:JSON.stringify({mode:"cloud",action:"connect"})}));
  expect(response.status).toBe(403); expect(api.selectedRenderMode()).toBeNull();
});
it("accepts the browser's loopback host even when Next normalizes the internal URL", async () => {
  const api = await setup();
  const {POST} = await import("@/app/api/rendering/route");
  const response = await POST(new NextRequest("http://localhost:32179/api/rendering", {method:"POST",headers:{host:"127.0.0.1:32179",origin:"http://127.0.0.1:32179","content-type":"application/json"},body:JSON.stringify({mode:"local"})}));
  expect(response.status).toBe(200); expect(api.selectedRenderMode()).toBe("local");
});
