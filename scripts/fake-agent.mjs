#!/usr/bin/env node
/**
 * Fake agent CLI for benchmarks: emits Claude-CLI-compatible stream-json
 * NDJSON over FAKE_AGENT_DURATION_S seconds (default 30), then exits 0.
 * scripts/bench-tabs.mjs puts a `claude` shim pointing here on the bench
 * server's PATH, so runs cost no API calls and no CPU.
 */

import { randomUUID } from "node:crypto";

const durationMs = (Number.parseFloat(process.env.FAKE_AGENT_DURATION_S || "30") || 30) * 1000;
const sessionId = randomUUID();

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

emit({ type: "system", subtype: "init", session_id: sessionId, model: "fake-agent" });

const started = Date.now();
const stepMs = Math.max(1000, durationMs / 10);
let step = 0;
while (Date.now() - started < durationMs) {
  step += 1;
  emit({
    type: "assistant",
    session_id: sessionId,
    message: { content: [{ type: "text", text: `fake work step ${step}` }] },
  });
  await sleep(Math.min(stepMs, Math.max(0, durationMs - (Date.now() - started))));
}

emit({ type: "result", subtype: "success", session_id: sessionId, result: "Fake run complete." });
