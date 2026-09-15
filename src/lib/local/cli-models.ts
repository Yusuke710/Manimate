import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { AVAILABLE_MODELS } from "@/lib/models";

function readJson(file: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function modelName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Read CLI defaults without invoking a model or overriding CLI selection. */
export function readConfiguredCliModels(env: Record<string, string | undefined> = process.env, home = os.homedir()) {
  const claudeRoot = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const claudeSettings = readJson(path.join(claudeRoot, "settings.json"));
  const claudeEnv = claudeSettings.env as Record<string, unknown> | undefined;
  const claude = modelName(claudeEnv?.ANTHROPIC_MODEL) || modelName(env.ANTHROPIC_MODEL) || modelName(claudeSettings.model);
  let codex: string | null = null;
  try {
    const config = parse(fs.readFileSync(path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"), "utf8"));
    const profiles = config.profiles as Record<string, Record<string, unknown>> | undefined;
    const profile = typeof config.profile === "string" ? profiles?.[config.profile] : undefined;
    codex = modelName(profile?.model) || modelName(config.model);
  } catch { /* Missing or invalid config: the CLI owns its built-in default. */ }
  return AVAILABLE_MODELS.map(({ id, label }) => {
    const configuredModel = id === "claude" ? claude : codex;
    return { id, configuredModel, label: `${label} · ${configuredModel || "CLI default"}` };
  });
}
