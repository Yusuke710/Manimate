#!/usr/bin/env node
/**
 * Browser-tab concurrency benchmark.
 *
 * Reproduces the "N tabs, only M runs start" ceiling end-to-end with real
 * Chrome (which enforces the 6-connections-per-origin HTTP/1.1 limit that
 * curl-based tests cannot see):
 *
 *   1. Starts an isolated Manimate dev server: temp MANIMATE_LOCAL_ROOT,
 *      its own dist dir (MANIMATE_DIST_DIR), and a PATH shim so `claude`
 *      resolves to scripts/fake-agent.mjs — runs cost nothing and take
 *      FAKE_AGENT_DURATION_S seconds.
 *   2. Opens TABS headless-Chrome tabs on /?prompt=bench&send=1&model=claude.
 *   3. After OBSERVE_S seconds, counts sessions whose run actually started.
 *
 * Usage:
 *   node scripts/bench-tabs.mjs [--tabs 8] [--observe 20] [--duration 45]
 *
 * Expected on the current SSE-per-run architecture: runs started ≈ 6 (browser
 * connection limit), regardless of server capacity. A fix that detaches runs
 * from held connections should make runs started == tabs.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) return fallback;
  const parsed = Number.parseInt(argv[index + 1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const TABS = argValue("--tabs", 8);
const OBSERVE_S = argValue("--observe", 20);
const DURATION_S = argValue("--duration", 45);
const PORT = 33000 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-bench-"));
const shimDir = path.join(localRoot, "bin");
fs.mkdirSync(shimDir, { recursive: true });
const fakeAgentPath = path.join(repoRoot, "scripts", "fake-agent.mjs");
for (const name of ["claude", "codex"]) {
  const shimPath = path.join(shimDir, name);
  fs.writeFileSync(shimPath, `#!/bin/sh\nexec node "${fakeAgentPath}" "$@"\n`);
  fs.chmodSync(shimPath, 0o755);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  throw new Error(`Server did not become ready at ${url}`);
}

async function countBenchSessions() {
  const sessionsRoot = path.join(localRoot, "sessions");
  let created = 0;
  let runsStarted = 0;
  let dirs = [];
  try {
    dirs = await fsp.readdir(sessionsRoot);
  } catch {
    return { created, runsStarted };
  }
  for (const dir of dirs) {
    try {
      const raw = await fsp.readFile(path.join(sessionsRoot, dir, "session.json"), "utf8");
      const session = JSON.parse(raw);
      created += 1;
      if (session.messages?.some((m) => m.run)) runsStarted += 1;
    } catch {
      // Ignore partial writes.
    }
  }
  return { created, runsStarted };
}

const log = (message) => console.log(`[bench] ${message}`);

log(`local root: ${localRoot}`);
log(`starting isolated server on :${PORT} (fake ${DURATION_S}s agent, ${TABS} tabs, observe ${OBSERVE_S}s)`);

const server = spawn(
  process.execPath,
  [path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(PORT), "--hostname", "127.0.0.1"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      MANIMATE_LOCAL_ROOT: localRoot,
      MANIMATE_DIST_DIR: ".next-bench",
      FAKE_AGENT_DURATION_S: String(DURATION_S),
      PATH: `${shimDir}:${process.env.PATH}`,
      // Ensure no cloud sync fires from bench sessions.
      MANIMATE_CLOUD_SYNC_URL: "",
      MANIMATE_CLOUD_SYNC_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  }
);
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

let browser = null;
let exitCode = 1;
try {
  await waitForServer(BASE_URL, 120_000);
  // Compile the heavy routes once so tab-opening measures concurrency, not compilation.
  await fetch(`${BASE_URL}/api/sessions`).catch(() => {});
  log("server ready, launching headless Chrome");

  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext();

  const runUrl = `${BASE_URL}/?prompt=bench%20run&send=1&model=claude&voice_id=none&aspect_ratio=16%3A9`;
  // Load the home page once so the client bundle is compiled before the burst.
  const warmPage = await context.newPage();
  await warmPage.goto(BASE_URL, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
  await warmPage.close();

  log(`opening ${TABS} tabs`);
  const openedAt = Date.now();
  await Promise.all(
    Array.from({ length: TABS }, async () => {
      const page = await context.newPage();
      // goto resolves on load; the auto-send fires from client JS afterwards.
      await page.goto(runUrl, { waitUntil: "commit", timeout: 60_000 }).catch(() => {});
    })
  );

  log(`tabs open in ${((Date.now() - openedAt) / 1000).toFixed(1)}s, observing for ${OBSERVE_S}s`);
  await sleep(OBSERVE_S * 1000);

  const { created, runsStarted } = await countBenchSessions();
  console.log("");
  console.log(`RESULT tabs=${TABS} sessions_created=${created} runs_started=${runsStarted}`);
  console.log(
    runsStarted >= TABS
      ? "PASS: every tab started a run"
      : `CEILING: ${TABS - runsStarted} tab(s) never reached the server (browser connection limit or server stall)`
  );
  exitCode = 0;
} catch (error) {
  console.error(`[bench] failed: ${error instanceof Error ? error.message : error}`);
  console.error(serverOutput.slice(-2000));
} finally {
  await browser?.close().catch(() => {});
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  await sleep(500);
  fs.rmSync(localRoot, { recursive: true, force: true });
}
process.exit(exitCode);
