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

  it("copies only CLAUDE.md for Claude sessions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-local-config-"));
    process.env.MANIMATE_LOCAL_ROOT = root;
    vi.resetModules();

    const { ensureLocalSessionLayout } = await import("@/lib/local/config");
    const paths = ensureLocalSessionLayout("session-1", { model: "claude" });

    const claudePath = path.join(paths.projectDir, "CLAUDE.md");
    const agentsPath = path.join(paths.projectDir, "AGENTS.md");
    expect(fs.existsSync(claudePath)).toBe(true);
    expect(fs.existsSync(agentsPath)).toBe(false);
    expect(fs.readFileSync(claudePath, "utf8")).toBe(
      fs.readFileSync(
        path.join(process.cwd(), "src", "lib", "local", "prompts", "CLAUDE.md"),
        "utf8"
      )
    );

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies only AGENTS.md for Codex sessions and removes stale CLAUDE.md", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-local-config-"));
    process.env.MANIMATE_LOCAL_ROOT = root;
    vi.resetModules();

    const { ensureLocalSessionLayout } = await import("@/lib/local/config");
    const paths = ensureLocalSessionLayout("session-1", { model: "claude" });
    const claudePath = path.join(paths.projectDir, "CLAUDE.md");
    const agentsPath = path.join(paths.projectDir, "AGENTS.md");
    expect(fs.existsSync(claudePath)).toBe(true);

    ensureLocalSessionLayout("session-1", { model: "codex" });

    expect(fs.existsSync(claudePath)).toBe(false);
    expect(fs.existsSync(agentsPath)).toBe(true);
    expect(fs.readFileSync(agentsPath, "utf8")).toBe(
      fs.readFileSync(
        path.join(process.cwd(), "src", "lib", "local", "prompts", "AGENTS.md"),
        "utf8"
      )
    );

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not sync prompt files unless a runtime model is provided", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-local-config-"));
    process.env.MANIMATE_LOCAL_ROOT = root;
    vi.resetModules();

    const { ensureLocalSessionLayout } = await import("@/lib/local/config");
    const paths = ensureLocalSessionLayout("session-1");

    expect(fs.existsSync(path.join(paths.projectDir, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(paths.projectDir, "AGENTS.md"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
