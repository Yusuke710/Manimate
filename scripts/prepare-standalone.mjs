#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_STATIC_PATH = path.join(PROJECT_ROOT, ".next", "static");
const NEXT_STANDALONE_ROOT = path.join(PROJECT_ROOT, ".next", "standalone");
const NEXT_STANDALONE_STATIC_PATH = path.join(PROJECT_ROOT, ".next", "standalone", ".next", "static");
const PROMPTS_SOURCE_PATH = path.join(PROJECT_ROOT, "src", "lib", "local", "prompts");
const PROMPTS_STANDALONE_PATH = path.join(NEXT_STANDALONE_ROOT, "src", "lib", "local", "prompts");
const SCRIPTS_STANDALONE_PATH = path.join(NEXT_STANDALONE_ROOT, "scripts");
const HELPER_SCRIPT_NAMES = ["tts-generate.py", "lint-subtitles.py"];

async function removeStandaloneEnvFiles() {
  const entries = await fs.readdir(NEXT_STANDALONE_ROOT).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry === ".env" || entry.startsWith(".env."))
      .map((entry) => fs.rm(path.join(NEXT_STANDALONE_ROOT, entry), { force: true, recursive: true }))
  );
}

async function main() {
  await fs.access(NEXT_STATIC_PATH);
  await fs.mkdir(path.dirname(NEXT_STANDALONE_STATIC_PATH), { recursive: true });
  await fs.rm(NEXT_STANDALONE_STATIC_PATH, { recursive: true, force: true });
  await fs.cp(NEXT_STATIC_PATH, NEXT_STANDALONE_STATIC_PATH, { recursive: true });
  await fs.mkdir(PROMPTS_STANDALONE_PATH, { recursive: true });
  await fs.cp(PROMPTS_SOURCE_PATH, PROMPTS_STANDALONE_PATH, { recursive: true });
  await fs.mkdir(SCRIPTS_STANDALONE_PATH, { recursive: true });
  await Promise.all(
    HELPER_SCRIPT_NAMES.map((scriptName) =>
      fs.cp(
        path.join(PROJECT_ROOT, "scripts", scriptName),
        path.join(SCRIPTS_STANDALONE_PATH, scriptName)
      )
    )
  );
  await removeStandaloneEnvFiles();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
