#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.MANIMATE_BASE_URL || "http://localhost:3000";

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Manimate tool CLI

Usage:
  node scripts/manimate-tool.mjs generate --prompt "<text>" [options]

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
  --help                   Show this help
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

async function streamGenerate(options) {
  const payload = {
    prompt: options.prompt,
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
    ...(options.voiceId ? { voice_id: options.voiceId } : {}),
  };

  const endpoint = `${options.baseUrl}/api/tool/generate`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    const parsed = safeJsonParse(text);
    const message =
      (parsed && typeof parsed.error === "string" && parsed.error) ||
      `HTTP ${response.status}: ${text || "request failed"}`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("No response body from tool endpoint");
  }

  let sessionId = response.headers.get("x-manimate-session-id") || options.sessionId || null;
  let runId = null;
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
        status = completeMsg === "Stopped by user" ? "canceled" : "completed";
        message = completeMsg;
        sawTerminal = true;
      }
    }
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
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "--help" || command === "-h") usage(0);

  if (command !== "generate") {
    console.error(`Unknown command: ${command}`);
    usage(1);
  }

  try {
    const options = parseGenerateArgs(rest);
    const result = await streamGenerate(options);

    if (options.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`status: ${result.status}`);
      if (result.session_id) console.log(`session_id: ${result.session_id}`);
      if (result.run_id) console.log(`run_id: ${result.run_id}`);
      if (result.video_url) console.log(`video_url: ${result.video_url}`);
      if (result.review_url) console.log(`review_url: ${result.review_url}`);
      if (result.message) console.log(`message: ${result.message}`);
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

main();
