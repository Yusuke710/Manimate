import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

describe("ensureLocalSessionLayout", () => {
  afterEach(() => {
    vi.resetModules();
    if (ORIGINAL_LOCAL_ROOT === undefined) {
      delete process.env.MANIMATE_LOCAL_ROOT;
    } else {
      process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
    }
  });

  it("copies both runtime prompt files into the session project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-local-config-"));
    process.env.MANIMATE_LOCAL_ROOT = root;
    vi.resetModules();

    const { ensureLocalSessionLayout } = await import("@/lib/local/config");
    const paths = ensureLocalSessionLayout("session-1");

    const claudePath = path.join(paths.projectDir, "CLAUDE.md");
    const agentsPath = path.join(paths.projectDir, "AGENTS.md");
    expect(fs.existsSync(claudePath)).toBe(true);
    expect(fs.existsSync(agentsPath)).toBe(true);
    expect(fs.readFileSync(agentsPath, "utf8")).toBe(
      fs.readFileSync(
        path.join(process.cwd(), "src", "lib", "local", "prompts", "AGENTS.md"),
        "utf8"
      )
    );

    fs.rmSync(root, { recursive: true, force: true });
  });
});
