#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json");
const DEFAULT_APP_HOST = process.env.MANIMATE_APP_HOST || "127.0.0.1";
const DEFAULT_APP_PORT = parsePositiveInteger(process.env.MANIMATE_APP_PORT, 3000);
const DEFAULT_BASE_URL = process.env.MANIMATE_BASE_URL || `http://${DEFAULT_APP_HOST}:${DEFAULT_APP_PORT}`;
const DEFAULT_CLOUD_BASE_URL = process.env.MANIMATE_CLOUD_SYNC_URL || "https://manimate.ai";
const DEFAULT_OPEN_TIMEOUT_SECONDS = 45;
const NONE_VOICE_ID = "none";
const STATUS_ENDPOINT_PATH = "/api/cloud-sync/status";
const STATUS_MARKER_HEADER_NAME = "x-manimate-studio";
const STATUS_MARKER_HEADER_VALUE = "local";
const CLI_VERSION = typeof packageMetadata.version === "string" ? packageMetadata.version.trim() : "";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_CLI_PATH = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
const NEXT_BUILD_ID_PATH = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
const NEXT_STATIC_PATH = path.join(PROJECT_ROOT, ".next", "static");
const NEXT_STANDALONE_ROOT = path.join(PROJECT_ROOT, ".next", "standalone");
const NEXT_STANDALONE_SERVER_PATH = path.join(PROJECT_ROOT, ".next", "standalone", "server.js");
const NEXT_STANDALONE_STATIC_PATH = path.join(NEXT_STANDALONE_ROOT, ".next", "static");
const REMOVED_SUBCOMMANDS = new Map([
  ["connect", "Open `manimate` with no prompt to reconnect through the browser flow."],
  ["generate", "Pass the prompt directly: `manimate \"your prompt\"`."],
  ["open", "Run `manimate` with no prompt to launch the app."],
]);

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Manimate tool CLI

Usage:
  manimate
  manimate stop [options]
  manimate "<prompt>" [options]

Generate Options:
  -p, --prompt <text>      Prompt text
  -s, --session <id>       Reuse a specific session ID
  -m, --model <id>         Model override (opus|sonnet|haiku)
  -a, --aspect <value>     Aspect ratio (16:9|9:16|1:1)
  -v, --voice <id>         Voice ID override
  --no-voice               Disable voiceover (default)
  --base-url <url>         API base URL (default: ${DEFAULT_BASE_URL})
  --show-events            Print readable live SSE events to stderr
  --quiet                  Suppress progress logs
  Ctrl-C behavior          First press requests server cancel; second press force-exits
  --help                   Show this help

Open Options:
  --base-url <url>         Local app URL (default: ${DEFAULT_BASE_URL})
  --cloud-base-url <url>   Hosted site URL for autosync auth (default: ${DEFAULT_CLOUD_BASE_URL})
  --port <number>          Local app port override (otherwise picked automatically)
  --host <hostname>        Local app host override (default: ${DEFAULT_APP_HOST})
  --mode <auto|standalone|dev|start>  Launch mode (default: auto)
  --timeout <seconds>      Wait time for local app startup (default: ${DEFAULT_OPEN_TIMEOUT_SECONDS})
  --restart                Restart an existing local Manimate server on this port
  --no-open                Start local app without opening the browser

Stop Options:
  --base-url <url>         Local app URL to stop (default: ${DEFAULT_BASE_URL})
  --port <number>          Local app port override (default: ${DEFAULT_APP_PORT})
  --host <hostname>        Local app host override (default: ${DEFAULT_APP_HOST})
`);
  process.exit(code);
}

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseGenerateArgs(argv) {
  const options = {
    prompt: "",
    sessionId: "",
    model: "",
    aspectRatio: "",
    voiceId: NONE_VOICE_ID,
    baseUrl: DEFAULT_BASE_URL,
    baseUrlExplicit: false,
    showEvents: false,
    json: true,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--prompt":
      case "-p":
        options.prompt = nextValue(argv, i, "--prompt");
        i += 1;
        break;
      case "--session":
      case "-s":
        options.sessionId = nextValue(argv, i, "--session");
        i += 1;
        break;
      case "--model":
      case "-m":
        options.model = nextValue(argv, i, "--model");
        i += 1;
        break;
      case "--aspect-ratio":
      case "--aspect":
      case "-a":
        options.aspectRatio = nextValue(argv, i, "--aspect-ratio");
        i += 1;
        break;
      case "--voice":
      case "--voice-id":
      case "-v":
        options.voiceId = nextValue(argv, i, arg);
        i += 1;
        break;
      case "--no-voice":
        options.voiceId = NONE_VOICE_ID;
        break;
      case "--base-url":
        options.baseUrl = nextValue(argv, i, "--base-url");
        options.baseUrlExplicit = true;
        i += 1;
        break;
      case "--show-events":
        options.showEvents = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
        usage(0);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        if (options.prompt) {
          throw new Error(`Unexpected argument: ${arg}`);
        }
        const promptParts = [arg];
        while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          promptParts.push(argv[i + 1]);
          i += 1;
        }
        options.prompt = promptParts.join(" ");
        break;
    }
  }

  options.prompt = options.prompt.trim();
  if (!options.prompt) {
    throw new Error("prompt is required");
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

function normalizeLoopbackHost(hostname) {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]") {
    return "loopback";
  }
  return normalized;
}

function parseUrlOrNull(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackBaseUrl(value) {
  const parsed = parseUrlOrNull(value);
  return Boolean(parsed && normalizeLoopbackHost(parsed.hostname) === "loopback");
}

function getUrlPort(url) {
  return Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
}

function urlsUseSameLocalPort(left, right) {
  const parsedLeft = parseUrlOrNull(left);
  const parsedRight = parseUrlOrNull(right);
  if (!parsedLeft || !parsedRight) return false;

  return (
    normalizeLoopbackHost(parsedLeft.hostname) === "loopback" &&
    normalizeLoopbackHost(parsedRight.hostname) === "loopback" &&
    getUrlPort(parsedLeft) === getUrlPort(parsedRight)
  );
}

function parseOpenArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    cloudBaseUrl: DEFAULT_CLOUD_BASE_URL,
    host: DEFAULT_APP_HOST,
    port: DEFAULT_APP_PORT,
    mode: "auto",
    noOpen: false,
    restart: false,
    timeoutSeconds: DEFAULT_OPEN_TIMEOUT_SECONDS,
    portAdjusted: false,
    portAdjustedReason: null,
    baseUrlExplicit: false,
    portExplicit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--base-url":
        options.baseUrl = nextValue(argv, i, "--base-url");
        options.baseUrlExplicit = true;
        i += 1;
        break;
      case "--cloud-base-url":
        options.cloudBaseUrl = nextValue(argv, i, "--cloud-base-url");
        i += 1;
        break;
      case "--port":
        options.port = parsePositiveInteger(nextValue(argv, i, "--port"), NaN);
        options.portExplicit = true;
        i += 1;
        break;
      case "--host":
      case "--hostname":
        options.host = nextValue(argv, i, arg);
        i += 1;
        break;
      case "--mode":
        options.mode = nextValue(argv, i, "--mode");
        i += 1;
        break;
      case "--timeout":
        options.timeoutSeconds = Number.parseInt(nextValue(argv, i, "--timeout"), 10);
        i += 1;
        break;
      case "--restart":
        options.restart = true;
        break;
      case "--no-open":
        options.noOpen = true;
        break;
      case "--help":
        usage(0);
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  if (!options.baseUrlExplicit) {
    options.baseUrl = `http://${options.host}:${options.port}`;
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  options.cloudBaseUrl = options.cloudBaseUrl.replace(/\/+$/, "");
  options.mode = options.mode.trim().toLowerCase();
  if (!["auto", "standalone", "dev", "start"].includes(options.mode)) {
    throw new Error("--mode must be one of: auto, standalone, dev, start");
  }
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive integer");
  }

  return options;
}

function parseStopArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    host: DEFAULT_APP_HOST,
    port: DEFAULT_APP_PORT,
    baseUrlExplicit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--base-url":
        options.baseUrl = nextValue(argv, i, "--base-url");
        options.baseUrlExplicit = true;
        i += 1;
        break;
      case "--port":
        options.port = parsePositiveInteger(nextValue(argv, i, "--port"), NaN);
        i += 1;
        break;
      case "--host":
      case "--hostname":
        options.host = nextValue(argv, i, arg);
        i += 1;
        break;
      case "--help":
        usage(0);
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  if (!options.baseUrlExplicit) {
    options.baseUrl = `http://${options.host}:${options.port}`;
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  return options;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncateText(value, maxChars = 160) {
  if (typeof value !== "string") return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function compactJson(value, maxChars = 160) {
  try {
    return truncateText(JSON.stringify(value), maxChars);
  } catch {
    return "";
  }
}

function baseUrlHint(baseUrl) {
  return `Check that Manimate is running at ${baseUrl} or pass --base-url / set MANIMATE_BASE_URL.`;
}

function summarizeToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (typeof toolInput.command === "string" && toolInput.command.trim()) {
    return truncateText(toolInput.command.trim());
  }
  if (typeof toolInput.file_path === "string" && toolInput.file_path.trim()) {
    return `file=${truncateText(toolInput.file_path.trim())}`;
  }
  return compactJson(toolInput);
}

function inferImplicitCommand(argv) {
  if (argv.length === 0) return "open";
  if (argv[0] === "stop") return "stop";

  const generateFlags = new Set([
    "--prompt",
    "-p",
    "--session",
    "-s",
    "--model",
    "-m",
    "--aspect-ratio",
    "--aspect",
    "-a",
    "--voice",
    "--voice-id",
    "-v",
    "--no-voice",
    "--show-events",
    "--quiet",
  ]);

  if (argv.some((arg) => generateFlags.has(arg))) {
    return "generate";
  }

  if (!argv[0].startsWith("-")) {
    return "generate";
  }

  return "open";
}

function rejectRemovedSubcommand(argv) {
  const candidate = argv[0]?.trim().toLowerCase();
  if (!candidate) return;

  const guidance = REMOVED_SUBCOMMANDS.get(candidate);
  if (!guidance) return;

  throw new Error(`\`${candidate}\` is no longer a subcommand. ${guidance}`);
}

function printHumanResult(result) {
  console.log(`status: ${result.status}`);
  if (result.app_url) console.log(`app_url: ${result.app_url}`);
  if (result.cloud_base_url) console.log(`cloud_base_url: ${result.cloud_base_url}`);
  if (result.session_id) console.log(`session_id: ${result.session_id}`);
  if (result.run_id) console.log(`run_id: ${result.run_id}`);
  if (result.video_url) console.log(`video_url: ${result.video_url}`);
  if (result.review_url) console.log(`review_url: ${result.review_url}`);
  if (typeof result.server_started === "boolean") console.log(`server_started: ${result.server_started}`);
  if (typeof result.server_restarted === "boolean") console.log(`server_restarted: ${result.server_restarted}`);
  if (typeof result.server_stopped === "boolean") console.log(`server_stopped: ${result.server_stopped}`);
  if (result.server_mode) console.log(`server_mode: ${result.server_mode}`);
}

function printEventLine(event) {
  const type = typeof event.type === "string" ? event.type : "event";
  if (type === "assistant_text") {
    console.error(`[manimate] assistant ${truncateText(String(event.message || ""))}`);
    return;
  }

  if (type === "progress") {
    const state = typeof event.state === "string" ? event.state : "progress";
    const message = typeof event.message === "string" ? event.message : "";
    console.error(`[manimate] progress ${state} ${truncateText(message)}`);
    return;
  }

  if (type === "tool_use") {
    const toolName = typeof event.tool_name === "string" ? event.tool_name : "Tool";
    const detail = summarizeToolInput(event.tool_input);
    console.error(`[manimate] tool_use ${toolName}${detail ? ` ${detail}` : ""}`);
    return;
  }

  if (type === "tool_result") {
    const isError = Boolean(event.is_error);
    const resultText =
      typeof event.tool_result === "string" && event.tool_result.trim()
        ? event.tool_result
        : typeof event.message === "string"
          ? event.message
          : "";
    console.error(`[manimate] tool_result ${isError ? "error" : "ok"} ${truncateText(resultText)}`);
    return;
  }

  if (type === "system_init") {
    const model = typeof event.model === "string" ? event.model : "unknown";
    const sessionId = typeof event.session_id === "string" ? event.session_id : "?";
    console.error(`[manimate] system_init session=${sessionId} model=${model}`);
    return;
  }

  if (type === "complete") {
    const runId = typeof event.run_id === "string" ? event.run_id : "?";
    const videoUrl = typeof event.video_url === "string" ? event.video_url : "";
    const suffix = videoUrl ? ` video=${truncateText(videoUrl)}` : "";
    console.error(`[manimate] complete run=${runId}${suffix}`);
    return;
  }

  if (type === "error") {
    const message = typeof event.message === "string" ? event.message : "Generation failed";
    console.error(`[manimate] error ${truncateText(message)}`);
    return;
  }

  const message = typeof event.message === "string" ? event.message : "";
  console.error(`[manimate] ${type} ${truncateText(message)}`);
}

async function requestServerCancel(baseUrl, sessionId) {
  const response = await fetch(`${baseUrl}/api/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const text = await response.text();
  const parsed = safeJsonParse(text);
  if (!response.ok) {
    const message =
      (parsed && typeof parsed.error === "string" && parsed.error) ||
      `HTTP ${response.status}: ${text || "cancel request failed"}`;
    throw new Error(message);
  }
  const message =
    (parsed && typeof parsed.message === "string" && parsed.message) ||
    "Cancel requested";
  return message;
}

async function streamGenerate(options) {
  if (isLoopbackBaseUrl(options.baseUrl)) {
    const probe = await probeLocalManimate(options.baseUrl);
    if (!probe.ok) {
      const parsedBaseUrl = parseBaseUrl(options.baseUrl);
      const port = Number.parseInt(parsedBaseUrl.port || (parsedBaseUrl.protocol === "https:" ? "443" : "80"), 10);
      const openResult = await openLocalApp({
        baseUrl: options.baseUrl,
        cloudBaseUrl: DEFAULT_CLOUD_BASE_URL,
        host: parsedBaseUrl.hostname,
        port,
        mode: "auto",
        noOpen: true,
        restart: false,
        json: false,
        timeoutSeconds: DEFAULT_OPEN_TIMEOUT_SECONDS,
        portAdjusted: false,
        portAdjustedReason: null,
        baseUrlExplicit: options.baseUrlExplicit,
        portExplicit: false,
      });
      options.baseUrl = openResult.app_url || options.baseUrl;
      if (!options.quiet) {
        console.error(`[manimate] ${openResult.message}`);
      }
    }
  }

  const payload = {
    prompt: options.prompt,
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
    ...(options.voiceId ? { voice_id: options.voiceId } : {}),
  };

  const abortController = new AbortController();
  let sessionId = options.sessionId || null;
  let runId = null;
  let interruptCount = 0;
  let firstInterruptAt = 0;
  let duplicateSignalNoted = false;
  let cancelIntent = false;
  let cancelRequested = false;
  let cancelPromise = null;
  const FORCE_EXIT_ARM_DELAY_MS = 1200;

  const maybeRequestCancel = () => {
    if (!cancelIntent || cancelRequested) return;
    const targetSessionId = sessionId || options.sessionId || null;
    if (!targetSessionId) return;
    cancelRequested = true;
    cancelPromise = (async () => {
      console.error(`[manimate] requesting cancel for session ${targetSessionId}...`);
      try {
        const message = await requestServerCancel(options.baseUrl, targetSessionId);
        console.error(`[manimate] cancel ${message}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[manimate] cancel failed ${message}`);
      }
    })();
  };

  const onInterrupt = (signalName) => {
    const now = Date.now();
    if (
      interruptCount >= 1 &&
      firstInterruptAt > 0 &&
      now - firstInterruptAt < FORCE_EXIT_ARM_DELAY_MS
    ) {
      if (!duplicateSignalNoted) {
        console.error("[manimate] duplicate interrupt ignored while cancel request is starting");
        duplicateSignalNoted = true;
      }
      return;
    }

    interruptCount += 1;
    if (interruptCount === 1) {
      firstInterruptAt = now;
      cancelIntent = true;
      console.error(`[manimate] ${signalName} received; requesting stop (press Ctrl-C again to force exit)`);
      maybeRequestCancel();
      if (!cancelRequested) {
        console.error("[manimate] session ID not available yet; will cancel as soon as it is known");
      }
      return;
    }
    console.error(`[manimate] ${signalName} received again; force exiting`);
    abortController.abort();
    process.exit(130);
  };

  const handleSigint = () => onInterrupt("SIGINT");
  const handleSigterm = () => onInterrupt("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const endpoint = `${options.baseUrl}/api/tool/generate`;
  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach Manimate at ${options.baseUrl}. ${baseUrlHint(options.baseUrl)} ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      const parsed = safeJsonParse(text);
      const message =
        (parsed && typeof parsed.error === "string" && parsed.error) ||
        `HTTP ${response.status}: ${text || "request failed"}`;
      if (response.status === 401) {
        throw new Error(`${message}. ${baseUrlHint(options.baseUrl)}`);
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("No response body from tool endpoint");
    }

    sessionId = response.headers.get("x-manimate-session-id") || sessionId;
    maybeRequestCancel();

    let videoUrl = null;
    let status = "running";
    let message = null;
    let sawTerminal = false;

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payloadText = line.slice(5).trimStart();
        if (!payloadText) continue;

        const event = safeJsonParse(payloadText);
        if (!event || typeof event !== "object") continue;

        if (typeof event.session_id === "string" && event.session_id) {
          sessionId = event.session_id;
          maybeRequestCancel();
        }
        if (typeof event.run_id === "string" && event.run_id) {
          runId = event.run_id;
        }
        if (typeof event.video_url === "string" && event.video_url) {
          videoUrl = event.video_url;
        }

        if (options.showEvents) {
          printEventLine(event);
        } else if (event.type === "progress" && !options.quiet && !options.json) {
          const progressMsg = typeof event.message === "string" ? event.message : "Running...";
          console.error(`[manimate] ${progressMsg}`);
        }

        if (event.type === "error") {
          status = "failed";
          message = typeof event.message === "string" ? event.message : "Generation failed";
          sawTerminal = true;
        } else if (event.type === "complete") {
          const completeMsg = typeof event.message === "string" ? event.message : "Complete";
          const terminalStatus = event.terminal_status === "canceled" || event.terminal_status === "completed"
            ? event.terminal_status
            : null;
          status = terminalStatus || (completeMsg === "Stopped by user" ? "canceled" : "completed");
          message = completeMsg;
          sawTerminal = true;
        }
      }
    }

    if (cancelPromise) {
      await cancelPromise;
    }

    if (!sawTerminal) {
      status = "failed";
      message = message || "Stream ended without a terminal event";
    }

    const reviewUrl = sessionId ? `${options.baseUrl}/?session=${encodeURIComponent(sessionId)}` : null;

    return {
      ok: status === "completed" || status === "canceled",
      status,
      session_id: sessionId,
      run_id: runId,
      video_url: videoUrl,
      review_url: reviewUrl,
      message,
    };
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function tryOpenBrowser(url) {
  const command = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];

  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function runCommandCapture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}${normalizeErrorMessage(error)}`,
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function listListeningPids(port) {
  const result = await runCommandCapture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]);
  if (!result.ok && result.code !== 1) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("p"))
    .map((line) => Number.parseInt(line.slice(1), 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

async function readProcessCwd(pid) {
  const result = await runCommandCapture("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  if (!result.ok) return null;

  const cwdLine = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("n"));

  return cwdLine ? cwdLine.slice(1) : null;
}

function isManagedProcessCwd(cwd) {
  if (!cwd) return false;
  const resolved = path.resolve(cwd);
  return resolved === PROJECT_ROOT || resolved === NEXT_STANDALONE_ROOT;
}

async function filterManagedPids(pids) {
  const managedPids = [];
  for (const pid of pids) {
    const cwd = await readProcessCwd(pid);
    if (isManagedProcessCwd(cwd)) {
      managedPids.push(pid);
    }
  }
  return managedPids;
}

function buildLoopbackBaseUrl(protocol, host, port) {
  return `${protocol}//${host}:${port}`;
}

async function resolveAutomaticOpenTarget(options) {
  if (options.baseUrlExplicit || options.portExplicit) {
    return options;
  }

  const parsedBaseUrl = parseBaseUrl(options.baseUrl);
  const preferredPort = Number.parseInt(parsedBaseUrl.port || (parsedBaseUrl.protocol === "https:" ? "443" : "80"), 10);
  const reservedCloudPort = urlsUseSameLocalPort(options.baseUrl, options.cloudBaseUrl)
    ? getUrlPort(parseBaseUrl(options.cloudBaseUrl))
    : null;
  const maxAttempts = 20;

  let firstReusablePort = null;
  let firstReusableReason = null;
  let firstFreePort = null;
  let preferredPortBlocked = false;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferredPort + offset;
    if (reservedCloudPort === port) {
      if (port === preferredPort) {
        preferredPortBlocked = true;
      }
      continue;
    }

    const pids = await listListeningPids(port);
    if (pids.length === 0) {
      if (firstFreePort === null) {
        firstFreePort = port;
      }
      continue;
    }

    const managedPids = await filterManagedPids(pids);
    if (managedPids.length === 0) {
      if (port === preferredPort) {
        preferredPortBlocked = true;
      }
      continue;
    }

    const candidateBaseUrl = buildLoopbackBaseUrl(parsedBaseUrl.protocol, parsedBaseUrl.hostname, port);
    const probe = await probeLocalManimate(candidateBaseUrl);
    if (probe.ok) {
      options.baseUrl = candidateBaseUrl;
      options.port = port;
      options.portAdjusted = port !== preferredPort;
      options.portAdjustedReason = port !== preferredPort ? "existing-instance" : null;
      return options;
    }

    if (options.restart && managedPids.length === pids.length && firstReusablePort === null) {
      firstReusablePort = port;
      firstReusableReason = port === preferredPort ? null : "existing-instance";
    }

    if (port === preferredPort) {
      preferredPortBlocked = true;
    }
  }

  const chosenPort = firstReusablePort ?? firstFreePort;
  if (chosenPort !== null) {
    options.baseUrl = buildLoopbackBaseUrl(parsedBaseUrl.protocol, parsedBaseUrl.hostname, chosenPort);
    options.port = chosenPort;
    options.portAdjusted = chosenPort !== preferredPort;
    if (chosenPort !== preferredPort) {
      options.portAdjustedReason =
        firstReusablePort === chosenPort
          ? firstReusableReason
          : preferredPortBlocked
            ? "port-in-use"
            : "port-in-use";
      if (reservedCloudPort === preferredPort) {
        options.portAdjustedReason = "cloud-port-conflict";
      }
    } else {
      options.portAdjustedReason = null;
    }
  }

  return options;
}

async function stopExistingLocalApp(options, config = {}) {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const port = Number.parseInt(baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80"), 10);
  const pids = await listListeningPids(port);
  if (pids.length === 0) {
    return { stoppedPids: [] };
  }

  const managedPids = await filterManagedPids(pids);
  const stoppablePids = config.allowUnmanaged ? pids : managedPids;

  if (stoppablePids.length === 0) {
    throw new Error(
      `Port ${port} is already in use by another process. ` +
      `Stop it manually or pick a different --port.`
    );
  }

  for (const pid of stoppablePids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const remaining = await listListeningPids(port);
    const stillManaged = remaining.filter((pid) => stoppablePids.includes(pid));
    if (stillManaged.length === 0) {
      return { stoppedPids: stoppablePids };
    }
    await sleep(250);
  }

  for (const pid of stoppablePids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  return { stoppedPids: stoppablePids };
}

function resolveStatusUrl(baseUrl) {
  return new URL(STATUS_ENDPOINT_PATH, `${baseUrl}/`).toString();
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isManimateStatusPayload(data, options = {}) {
  const markedLocal = options.markedLocal === true;
  if (!data || typeof data !== "object") return false;
  if (typeof data.status !== "string") return false;

  if (markedLocal) {
    return true;
  }

  return (
    typeof data.connected === "boolean" ||
    typeof data.base_url === "string" ||
    typeof data.connect_url === "string" ||
    typeof data.message === "string"
  );
}

function isMarkedLocalStudioResponse(response) {
  return response.headers.get(STATUS_MARKER_HEADER_NAME) === STATUS_MARKER_HEADER_VALUE;
}

async function probeLocalManimate(baseUrl) {
  try {
    const response = await fetchJsonWithTimeout(resolveStatusUrl(baseUrl), 1500);
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    if (isManimateStatusPayload(data, { markedLocal: isMarkedLocalStudioResponse(response) })) {
      return { ok: true, status: data };
    }
    return { ok: false, reason: "Unexpected response shape" };
  } catch (error) {
    return { ok: false, reason: normalizeErrorMessage(error) };
  }
}

function isInteractivePrompt() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

async function promptYesNo(question, defaultValue = true) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    return defaultValue;
  } finally {
    rl.close();
  }
}

async function maybeRestartVersionMismatch(existingStatus, options) {
  const runningVersion = normalizeVersion(existingStatus?.version);
  const installedVersion = normalizeVersion(CLI_VERSION);
  if (!installedVersion || runningVersion === installedVersion) {
    return { restart: false, stoppedPids: [] };
  }

  const versionSummary = runningVersion
    ? `Installed: ${installedVersion}\nRunning: ${runningVersion}`
    : `Installed: ${installedVersion}\nRunning: unknown`;
  const prompt =
    `A different Manimate version is already running at ${options.baseUrl}.\n` +
    `${versionSummary}\n` +
    "Restart with the installed version now?";

  if (!isInteractivePrompt()) {
    console.error(
      `${prompt}\nReusing the running server. Run \`manimate --restart\` to replace it.`
    );
    return { restart: false, stoppedPids: [] };
  }

  const shouldRestart = await promptYesNo(prompt, true);
  if (!shouldRestart) {
    return { restart: false, stoppedPids: [] };
  }

  const stopped = await stopExistingLocalApp(options, { allowUnmanaged: true });
  return { restart: true, stoppedPids: stopped.stoppedPids };
}

async function waitForLocalManimate(baseUrl, timeoutSeconds) {
  const deadline = Date.now() + (timeoutSeconds * 1000);
  let lastReason = "not started";

  while (Date.now() < deadline) {
    const probe = await probeLocalManimate(baseUrl);
    if (probe.ok) {
      return probe.status;
    }
    lastReason = probe.reason || lastReason;
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for Manimate at ${baseUrl}. ` +
    `If another app already owns that port, pass --port or --base-url. ` +
    `Last check: ${lastReason}`
  );
}

async function resolveLaunchMode(mode) {
  if (mode !== "auto") return mode;
  if (await fileExists(NEXT_STANDALONE_SERVER_PATH)) return "standalone";
  return (await fileExists(NEXT_BUILD_ID_PATH)) ? "start" : "dev";
}

async function ensureStandaloneStaticAssets() {
  if (await fileExists(NEXT_STANDALONE_STATIC_PATH)) {
    return;
  }
  if (!(await fileExists(NEXT_STATIC_PATH))) {
    throw new Error(`Missing Next.js static assets at ${NEXT_STATIC_PATH}. Run npm run build first.`);
  }

  await fs.mkdir(path.dirname(NEXT_STANDALONE_STATIC_PATH), { recursive: true });
  await fs.cp(NEXT_STATIC_PATH, NEXT_STANDALONE_STATIC_PATH, { recursive: true });
}

function parseBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid --base-url: ${baseUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--base-url must use http or https");
  }

  return parsed;
}

async function startLocalApp(options) {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const port = Number.parseInt(baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80"), 10);
  const host = baseUrl.hostname;
  const mode = await resolveLaunchMode(options.mode);
  const packageRoot = mode === "standalone" ? NEXT_STANDALONE_ROOT : PROJECT_ROOT;
  let args;
  if (mode === "standalone") {
    if (!(await fileExists(NEXT_STANDALONE_SERVER_PATH))) {
      throw new Error(`Missing standalone server at ${NEXT_STANDALONE_SERVER_PATH}. Run npm run build first.`);
    }
    await ensureStandaloneStaticAssets();
    args = [NEXT_STANDALONE_SERVER_PATH];
  } else {
    if (!(await fileExists(NEXT_CLI_PATH))) {
      throw new Error(`Missing Next.js CLI at ${NEXT_CLI_PATH}. Run npm install first.`);
    }
    args = [NEXT_CLI_PATH, mode, "--port", String(port), "--hostname", host];
  }
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      MANIMATE_PACKAGE_ROOT: packageRoot,
      PORT: String(port),
      HOSTNAME: host,
      MANIMATE_CLOUD_SYNC_URL: options.cloudBaseUrl,
      NEXT_PUBLIC_APP_URL: options.baseUrl,
    },
  });
  child.unref();

  return {
    mode,
    pid: child.pid ?? null,
  };
}

async function openLocalApp(options) {
  await resolveAutomaticOpenTarget(options);

  let stoppedPids = [];
  if (options.restart) {
    const stopped = await stopExistingLocalApp(options);
    stoppedPids = stopped.stoppedPids;
  }

  let existing = await probeLocalManimate(options.baseUrl);
  let serverStarted = false;
  let serverMode = null;
  let serverPid = null;

  if (existing.ok && !options.restart) {
    const versionDecision = await maybeRestartVersionMismatch(existing.status, options);
    if (versionDecision.restart) {
      stoppedPids = versionDecision.stoppedPids;
      existing = { ok: false, reason: "version-mismatch" };
    }
  }

  if (!existing.ok) {
    const started = await startLocalApp(options);
    serverStarted = true;
    serverMode = started.mode;
    serverPid = started.pid;
  }

  await waitForLocalManimate(options.baseUrl, options.timeoutSeconds);

  let browserOpened = false;
  if (!options.noOpen) {
    browserOpened = tryOpenBrowser(options.baseUrl);
  }

  return {
    ok: true,
    status: "ready",
    app_url: options.baseUrl,
    cloud_base_url: options.cloudBaseUrl,
    server_started: serverStarted,
    server_restarted: stoppedPids.length > 0,
    server_mode: serverMode,
    server_pid: serverPid,
    browser_opened: browserOpened,
    message: stoppedPids.length > 0
      ? `Restarted local Manimate on ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`
      : options.portAdjusted
      ? options.portAdjustedReason === "cloud-port-conflict"
        ? `Cloud sync target already uses ${options.cloudBaseUrl}; local Manimate moved to ${options.baseUrl}.`
        : options.portAdjustedReason === "existing-instance"
          ? `Reusing local Manimate at ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`
          : `Preferred local port was unavailable; local Manimate moved to ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`
      : `Local Manimate is running at ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`,
  };
}

async function stopLocalApp(options) {
  const stopped = await stopExistingLocalApp(options);
  return {
    ok: true,
    status: stopped.stoppedPids.length > 0 ? "stopped" : "not_running",
    app_url: options.baseUrl,
    server_stopped: stopped.stoppedPids.length > 0,
  };
}

async function main() {
  const [, , ...argv] = process.argv;
  if (argv[0] === "--help" || argv[0] === "-h") usage(0);

  try {
    rejectRemovedSubcommand(argv);
    const command = inferImplicitCommand(argv);
    const isOpenCommand = command === "open";
    const isStopCommand = command === "stop";
    const commandArgv = isStopCommand ? argv.slice(1) : argv;
    const options = isOpenCommand
      ? parseOpenArgs(commandArgv)
      : isStopCommand
        ? parseStopArgs(commandArgv)
        : parseGenerateArgs(commandArgv);
    const result = isOpenCommand
      ? await openLocalApp(options)
      : isStopCommand
        ? await stopLocalApp(options)
        : await streamGenerate(options);

    if (!isOpenCommand && !isStopCommand) {
      console.log(JSON.stringify(result));
    } else {
      printHumanResult(result);
    }

    if (result.review_url) {
      console.error(`Review in browser: ${result.review_url}`);
    }

    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

const isDirectExecution = (() => {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  try {
    return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main();
}
