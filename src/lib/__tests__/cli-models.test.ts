import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readConfiguredCliModels } from "@/lib/local/cli-models";

describe("configured CLI model labels", () => {
  it("reads arbitrary future model names and refreshes changed configuration", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-models-"));
    try {
      fs.mkdirSync(path.join(home, ".claude"));
      fs.mkdirSync(path.join(home, ".codex"));
      fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus-future[1m]", secret: "never expose" }));
      const codexConfig = path.join(home, ".codex", "config.toml");
      fs.writeFileSync(codexConfig, 'model = "gpt-future"\n[projects."/tmp"]\nmodel = "unrelated"\n');
      expect(readConfiguredCliModels({}, home)).toEqual([
        { id: "claude", configuredModel: "opus-future[1m]", label: "Claude · opus-future[1m]" },
        { id: "codex", configuredModel: "gpt-future", label: "Codex · gpt-future" },
      ]);
      fs.writeFileSync(codexConfig, 'model = "base"\nprofile = "work"\n[profiles.work]\nmodel = "profile-model"\n');
      expect(readConfiguredCliModels({}, home)[1].configuredModel).toBe("profile-model");
      expect(readConfiguredCliModels({ ANTHROPIC_MODEL: "env-model" }, home)[0].configuredModel).toBe("env-model");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  it("leaves unset defaults to the CLI instead of guessing a model version", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-models-"));
    try {
      expect(readConfiguredCliModels({}, home).map(model => model.label)).toEqual(["Claude · CLI default", "Codex · CLI default"]);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
