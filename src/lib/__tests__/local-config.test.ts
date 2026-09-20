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
  it("gives both agents the same cloud instructions and removes stale CLAUDE.md", async () => {
    const {ensureLocalSessionLayout} = await fixture();
    const paths = ensureLocalSessionLayout("session", {model: "claude"});
    const instructions = fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8");
    expect(instructions).toContain("manim-cloud script.py");
    expect(instructions).not.toContain("get_render");
    expect(instructions).toBe(fs.readFileSync("src/lib/local/prompts/cloud/AGENTS.md", "utf8"));
    fs.writeFileSync(path.join(paths.projectDir, "CLAUDE.md"), "old instructions");
    ensureLocalSessionLayout("session", {model: "codex"});
    expect(fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8")).toBe(instructions);
    expect(fs.existsSync(path.join(paths.projectDir, "CLAUDE.md"))).toBe(false);
  });

  it("switches only render instructions using the saved choice or environment override", async () => {
    const {root, ensureLocalSessionLayout} = await fixture();
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({render_mode: "local", unrelated: "keep"}));
    const paths = ensureLocalSessionLayout("session", {model: "claude"});
    let instructions = fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8");
    expect(instructions).toBe(fs.readFileSync("src/lib/local/prompts/local/AGENTS.md", "utf8"));
    expect(instructions).toContain("manim script.py");
    expect(instructions).not.toContain("manim-cloud");
    expect(instructions).toContain("ffprobe");
    vi.stubEnv("MANIMATE_RENDER_MODE", "cloud");
    ensureLocalSessionLayout("session", {model: "claude"});
    instructions = fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8");
    expect(instructions).toContain("manim-cloud script.py");
    expect(instructions).not.toContain("get_render");
    expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).unrelated).toBe("keep");
  });

  it("rejects an invalid mode rather than accidentally using cloud compute", async () => {
    const {ensureLocalSessionLayout} = await fixture();
    vi.stubEnv("MANIMATE_RENDER_MODE", "typo");
    expect(() => ensureLocalSessionLayout("session", {model: "claude"})).toThrow("cloud or local");
  });

  it("does not overwrite instructions during read-only session access", async () => {
    const {ensureLocalSessionLayout} = await fixture();
    const paths = ensureLocalSessionLayout("session");
    expect(fs.existsSync(path.join(paths.projectDir, "AGENTS.md"))).toBe(false);
  });
});
