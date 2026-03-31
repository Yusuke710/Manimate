#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_APP_HOST = process.env.MANIMATE_APP_HOST || "127.0.0.1";
const DEFAULT_APP_PORT = parsePositiveInteger(process.env.MANIMATE_APP_PORT, 3000);
const DEFAULT_BASE_URL = process.env.MANIMATE_BASE_URL || `http://${DEFAULT_APP_HOST}:${DEFAULT_APP_PORT}`;
const DEFAULT_CLOUD_BASE_URL = process.env.MANIMATE_CLOUD_SYNC_URL || "https://manimate.ai";
const DEFAULT_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT || path.join(os.homedir(), ".manimate");
const LOCAL_CONFIG_PATH = path.join(DEFAULT_LOCAL_ROOT, "config.json");
const DEFAULT_OPEN_TIMEOUT_SECONDS = 45;
const STATUS_ENDPOINT_PATH = "/api/cloud-sync/status";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_CLI_PATH = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
const NEXT_BUILD_ID_PATH = path.join(PROJECT_ROOT, ".next", "BUILD_ID");

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Manimate tool CLI

Usage:
  node scripts/manimate-tool.mjs
  node scripts/manimate-tool.mjs open [options]
  node scripts/manimate-tool.mjs generate --prompt "<text>" [options]
  node scripts/manimate-tool.mjs connect [options]

Options:
  --prompt <text>          Prompt text (required)
  --session <id>           Reuse a specific session ID
  --model <id>             Model override (opus|sonnet|haiku)
  --aspect-ratio <value>   Aspect ratio (16:9|9:16|1:1)
  --voice <id>             Voice ID override
  --base-url <url>         API base URL (default: ${DEFAULT_BASE_URL})
  --show-events            Print readable live SSE events to stderr
  --json                   Print final result as JSON
  --quiet                  Suppress progress logs
  Ctrl-C behavior          First press requests server cancel; second press force-exits
  --help                   Show this help

Open Options:
  --base-url <url>         Local app URL (default: ${DEFAULT_BASE_URL})
  --cloud-base-url <url>   Hosted site URL for autosync auth (default: ${DEFAULT_CLOUD_BASE_URL})
  --port <number>          Local app port override (otherwise picked automatically)
  --host <hostname>        Local app host override (default: ${DEFAULT_APP_HOST})
  --mode <auto|dev|start>  Launch mode (default: auto)
  --timeout <seconds>      Wait time for local app startup (default: ${DEFAULT_OPEN_TIMEOUT_SECONDS})
  --restart                Restart an existing local Manimate server on this port
  --no-open                Start local app without opening the browser

Connect Options:
  --base-url <url>         Hosted site URL (default: ${DEFAULT_CLOUD_BASE_URL})
  --device-name <name>     Label shown during browser approval
  --no-open                Do not attempt to open the browser automatically
  --timeout <seconds>      Approval timeout (default: 600)
`);
  process.exit(code);
}

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
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
    voiceId: "",
    baseUrl: DEFAULT_BASE_URL,
    showEvents: false,
    json: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--prompt":
        options.prompt = nextValue(argv, i, "--prompt");
        i += 1;
        break;
      case "--session":
        options.sessionId = nextValue(argv, i, "--session");
        i += 1;
        break;
      case "--model":
        options.model = nextValue(argv, i, "--model");
        i += 1;
        break;
      case "--aspect-ratio":
        options.aspectRatio = nextValue(argv, i, "--aspect-ratio");
        i += 1;
        break;
      case "--voice":
      case "--voice-id":
        options.voiceId = nextValue(argv, i, arg);
        i += 1;
        break;
      case "--base-url":
        options.baseUrl = nextValue(argv, i, "--base-url");
        i += 1;
        break;
      case "--json":
        options.json = true;
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
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  options.prompt = options.prompt.trim();
  if (!options.prompt) {
    throw new Error("--prompt is required");
  }
  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  return options;
}

function parseConnectArgs(argv) {
  const options = {
    baseUrl: DEFAULT_CLOUD_BASE_URL,
    deviceName: os.hostname(),
    noOpen: false,
    json: false,
    timeoutSeconds: 600,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--base-url":
        options.baseUrl = nextValue(argv, i, "--base-url");
        i += 1;
        break;
      case "--device-name":
        options.deviceName = nextValue(argv, i, "--device-name");
        i += 1;
        break;
      case "--timeout":
        options.timeoutSeconds = Number.parseInt(nextValue(argv, i, "--timeout"), 10);
        i += 1;
        break;
      case "--no-open":
        options.noOpen = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
        usage(0);
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive integer");
  }

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
    json: false,
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
      case "--json":
        options.json = true;
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
  if (!["auto", "dev", "start"].includes(options.mode)) {
    throw new Error("--mode must be one of: auto, dev, start");
  }
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive integer");
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

function cloudBaseUrlHint(baseUrl) {
  return `Check that the hosted site is reachable at ${baseUrl} or pass --base-url / set MANIMATE_CLOUD_SYNC_URL.`;
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

function readJsonFileSafe(filePath) {
  return fs.readFile(filePath, "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => ({}));
}

async function writeCloudSyncConfig(config) {
  await fs.mkdir(path.dirname(LOCAL_CONFIG_PATH), { recursive: true });
  const current = await readJsonFileSafe(LOCAL_CONFIG_PATH);
  const next = {
    ...(current && typeof current === "object" ? current : {}),
    cloud_sync: config,
  };
  await fs.writeFile(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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

async function filterManagedPids(pids) {
  const managedPids = [];
  for (const pid of pids) {
    const cwd = await readProcessCwd(pid);
    if (cwd && path.resolve(cwd) === PROJECT_ROOT) {
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

async function stopExistingLocalApp(options) {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const port = Number.parseInt(baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80"), 10);
  const pids = await listListeningPids(port);
  if (pids.length === 0) {
    return { stoppedPids: [] };
  }

  const managedPids = await filterManagedPids(pids);

  if (managedPids.length === 0) {
    throw new Error(
      `Port ${port} is already in use by another process. ` +
      `Stop it manually or pick a different --port.`
    );
  }

  for (const pid of managedPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const remaining = await listListeningPids(port);
    const stillManaged = remaining.filter((pid) => managedPids.includes(pid));
    if (stillManaged.length === 0) {
      return { stoppedPids: managedPids };
    }
    await sleep(250);
  }

  for (const pid of managedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  return { stoppedPids: managedPids };
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

async function probeLocalManimate(baseUrl) {
  try {
    const response = await fetchJsonWithTimeout(resolveStatusUrl(baseUrl), 1500);
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    if (
      data &&
      typeof data === "object" &&
      typeof data.status === "string" &&
      typeof data.connected === "boolean"
    ) {
      return { ok: true, status: data };
    }
    return { ok: false, reason: "Unexpected response shape" };
  } catch (error) {
    return { ok: false, reason: normalizeErrorMessage(error) };
  }
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
  return (await fileExists(NEXT_BUILD_ID_PATH)) ? "start" : "dev";
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
  if (!(await fileExists(NEXT_CLI_PATH))) {
    throw new Error(`Missing Next.js CLI at ${NEXT_CLI_PATH}. Run npm install first.`);
  }

  const baseUrl = parseBaseUrl(options.baseUrl);
  const port = Number.parseInt(baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80"), 10);
  const host = baseUrl.hostname;
  const mode = await resolveLaunchMode(options.mode);
  const args = [NEXT_CLI_PATH, mode, "--port", String(port), "--hostname", host];
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
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

  const existing = await probeLocalManimate(options.baseUrl);
  let serverStarted = false;
  let serverMode = null;
  let serverPid = null;

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
    message: options.portAdjusted
      ? options.portAdjustedReason === "cloud-port-conflict"
        ? `Cloud sync target already uses ${options.cloudBaseUrl}; local Manimate moved to ${options.baseUrl}.`
        : options.portAdjustedReason === "existing-instance"
          ? `Reusing local Manimate at ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`
          : `Preferred local port was unavailable; local Manimate moved to ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`
      : stoppedPids.length > 0
        ? `Restarted local Manimate on ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`
        : `Local Manimate is running at ${options.baseUrl}. Autosync auth and uploads use ${options.cloudBaseUrl}.`,
  };
}

async function startConnectRequest(options) {
  let response;
  try {
    response = await fetch(`${options.baseUrl}/api/local-sync/connect/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_name: options.deviceName,
      }),
    });
  } catch (error) {
    throw new Error(`Could not reach ${options.baseUrl}. ${cloudBaseUrlHint(options.baseUrl)} ${normalizeErrorMessage(error)}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function pollConnectRequest(options) {
  const deadline = Date.now() + (options.timeoutSeconds * 1000);
  const pollUrl = `${options.baseUrl}/api/local-sync/connect/poll?request_id=${encodeURIComponent(options.requestId)}&poll_token=${encodeURIComponent(options.pollToken)}`;

  while (Date.now() < deadline) {
    let response;
    try {
      response = await fetch(pollUrl);
    } catch (error) {
      throw new Error(`Failed to poll connect status. ${normalizeErrorMessage(error)}`);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new Error(message);
    }

    if (data.status === "approved" && typeof data.syncToken === "string") {
      return data;
    }

    if (data.status === "expired") {
      throw new Error("Connect request expired before approval");
    }

    await sleep(2000);
  }

  throw new Error("Timed out waiting for browser approval");
}

async function connectCloudSync(options) {
  const request = await startConnectRequest(options);

  if (!options.noOpen) {
    const opened = tryOpenBrowser(request.connect_url);
    if (!opened) {
      console.error("[manimate] could not open the browser automatically");
    }
  }

  if (!options.json) {
    console.error(`Open this URL to approve the device: ${request.connect_url}`);
    console.error(`Verification code: ${request.code}`);
    console.error("Waiting for browser approval...");
  }

  const approved = await pollConnectRequest({
    baseUrl: options.baseUrl,
    requestId: request.request_id,
    pollToken: request.poll_token,
    timeoutSeconds: options.timeoutSeconds,
  });

  const config = {
    base_url: options.baseUrl,
    token: approved.syncToken,
    connected_at: new Date().toISOString(),
    user_id: approved.user?.id || null,
    user_email: approved.user?.email || null,
    user_name: approved.user?.name || null,
    device_name: request.device_name || options.deviceName || null,
  };

  await writeCloudSyncConfig(config);

  return {
    ok: true,
    status: "connected",
    account_email: config.user_email,
    account_name: config.user_name,
    config_path: LOCAL_CONFIG_PATH,
    base_url: options.baseUrl,
  };
}

async function main() {
  const [, , maybeCommand, ...rest] = process.argv;
  if (maybeCommand === "--help" || maybeCommand === "-h") usage(0);

  const command = !maybeCommand || maybeCommand.startsWith("--") ? "open" : maybeCommand;
  const commandArgs = command === "open" && maybeCommand?.startsWith("--")
    ? [maybeCommand, ...rest]
    : rest;

  if (!["open", "generate", "connect"].includes(command)) {
    console.error(`Unknown command: ${command}`);
    usage(1);
  }

  try {
    const isOpenCommand = command === "open";
    const isConnectCommand = command === "connect";
    const options = isOpenCommand
      ? parseOpenArgs(commandArgs)
      : isConnectCommand
        ? parseConnectArgs(commandArgs)
        : parseGenerateArgs(commandArgs);
    const result = isOpenCommand
      ? await openLocalApp(options)
      : isConnectCommand
        ? await connectCloudSync(options)
        : await streamGenerate(options);

    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`status: ${result.status}`);
      if (result.app_url) console.log(`app_url: ${result.app_url}`);
      if (result.cloud_base_url) console.log(`cloud_base_url: ${result.cloud_base_url}`);
      if (result.session_id) console.log(`session_id: ${result.session_id}`);
      if (result.run_id) console.log(`run_id: ${result.run_id}`);
      if (result.video_url) console.log(`video_url: ${result.video_url}`);
      if (result.review_url) console.log(`review_url: ${result.review_url}`);
      if (result.account_email) console.log(`account_email: ${result.account_email}`);
      if (result.account_name) console.log(`account_name: ${result.account_name}`);
      if (result.config_path) console.log(`config_path: ${result.config_path}`);
      if (typeof result.server_started === "boolean") console.log(`server_started: ${result.server_started}`);
      if (typeof result.server_restarted === "boolean") console.log(`server_restarted: ${result.server_restarted}`);
      if (result.server_mode) console.log(`server_mode: ${result.server_mode}`);
      if (result.base_url && isConnectCommand) console.log(`base_url: ${result.base_url}`);
      if (result.message) console.log(`message: ${result.message}`);
    }

    if (result.review_url) {
      console.error(`Review in browser: ${result.review_url}`);
    }
    if (result.status === "ready" && !options.noOpen) {
      console.error(`Opening local Manimate in browser: ${result.app_url}`);
      console.error(`Cloud sync target: ${result.cloud_base_url}`);
    }
    if (result.status === "connected" && !options.json) {
      console.error("Autosync is now connected. Completed renders will sync in the background.");
    }

    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

main();
