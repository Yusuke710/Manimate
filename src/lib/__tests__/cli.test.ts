import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

 it("runs through an npm-style executable symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-bin-"));
  try {
    const executable = path.join(root, "manimate");
    fs.symlinkSync(path.resolve("scripts/cli.mjs"), executable);
    const result = spawnSync(process.execPath, [executable, "--help"], {encoding: "utf8"});
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("manimate");
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
