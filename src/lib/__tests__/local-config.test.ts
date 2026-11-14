import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-local-config-"));
  roots.push(root);
  vi.stubEnv("MANIMATE_LOCAL_ROOT", root);
  vi.stubEnv("MANIMATE_RENDER_MODE", "");
  vi.resetModules();
  return {root, ...await import("@/lib/local/config")};
}
afterEach(() => {
  vi.unstubAllEnvs(); vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});
});

describe("runtime instructions", () => {

  it("switches only render instructions using the saved choice or environment override", async () => {
    const {root, ensureLocalSessionLayout} = await fixture();
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({render_mode: "local", unrelated: "keep"}));
    const paths = ensureLocalSessionLayout("session", {model: "claude"});
    let instructions = fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8");
    expect(instructions).toBe(fs.readFileSync("src/lib/local/prompts/local/AGENTS.md", "utf8"));
    const ttsPath = path.join(paths.projectDir, "tts-generate.py");
    fs.writeFileSync(ttsPath, "# outdated helper");
    vi.stubEnv("MANIMATE_RENDER_MODE", "cloud");
    ensureLocalSessionLayout("session", {model: "claude"});
    instructions = fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8");
    expect(instructions).toBe(fs.readFileSync("src/lib/local/prompts/cloud/AGENTS.md", "utf8"));
    expect(fs.readFileSync(ttsPath, "utf8")).toBe(fs.readFileSync("scripts/tts-generate.py", "utf8"));
    expect(fs.readFileSync(path.join(paths.projectDir, "speech_client.py"), "utf8")).toBe(fs.readFileSync("scripts/speech_client.py", "utf8"));
    expect(fs.readFileSync(path.join(paths.projectDir, "manimate_cloud_auth.py"), "utf8")).toBe(fs.readFileSync("scripts/manim-cloud/cloud_auth.py", "utf8"));
    expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).unrelated).toBe("keep");
  });

});

it("resolves files without rewriting helpers and rejects symlinks outside the session", async () => {
  const {root, ensureLocalSessionLayout, resolveSessionFilePath} = await fixture();
  const {projectDir, sessionRoot} = ensureLocalSessionLayout("session");
  const helper = path.join(projectDir, "tts-generate.py");
  fs.writeFileSync(helper, "# session copy");
  fs.writeFileSync(path.join(projectDir, "video.mp4"), "video");
  fs.writeFileSync(path.join(root, "outside.txt"), "private");
  fs.symlinkSync(path.join(root, "outside.txt"), path.join(projectDir, "escape.txt"));
  fs.symlinkSync(path.join(projectDir, "video.mp4"), path.join(projectDir, "inside.mp4"));
  expect(resolveSessionFilePath("session", "escape.txt")).toBeNull();
  expect(resolveSessionFilePath("session", "inside.mp4")).toBe(fs.realpathSync(path.join(projectDir, "video.mp4")));
  expect(resolveSessionFilePath("session", "../../outside.txt")).toBeNull();
  expect(resolveSessionFilePath("session", path.join(sessionRoot, "thumbnail.jpg"))).toBe(path.join(sessionRoot, "thumbnail.jpg"));
  expect(fs.readFileSync(helper, "utf8")).toBe("# session copy");
  resolveSessionFilePath("missing", "video.mp4");
  expect(fs.existsSync(path.join(root, "sessions", "missing"))).toBe(false);
});
