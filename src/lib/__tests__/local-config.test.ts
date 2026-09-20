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
    vi.stubEnv("MANIMATE_RENDER_MODE", "cloud");
    ensureLocalSessionLayout("session", {model: "claude"});
    instructions = fs.readFileSync(path.join(paths.projectDir, "AGENTS.md"), "utf8");
    expect(instructions).toBe(fs.readFileSync("src/lib/local/prompts/cloud/AGENTS.md", "utf8"));
    expect(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).unrelated).toBe("keep");
  });

});
