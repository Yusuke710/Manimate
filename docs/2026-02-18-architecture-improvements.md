# Architecture Improvements Plan

From comparative analysis of E2B Surf, E2B Fragments, and Rivet Sandbox Agent.

**Constraint**: Magent's core = Claude Code CLI inside E2B sandbox, NDJSON stdout parsed server-side. Nothing here changes that.

**Non-goal**: Async generator SSE (Surf pattern). Magent's detached-IIFE design lets jobs survive client disconnect — the CLI keeps running, credits debit in `finally`, activity events persist to Supabase. Generator-based streaming would kill the job when `ReadableStream` is cancelled. Incompatible.

---

## 1. Split route.ts into modules

`src/app/api/chat/route.ts` is ~1800 lines. Everything is inline in one async IIFE.

### Target

```
src/app/api/chat/
  route.ts            ~100 lines: auth, wire modules, return Response
  sse-writer.ts       SSE transport layer
  validators.ts       Request body validation
  credit-gate.ts      Pre-flight check, mid-run estimation, post-run debit
  cli-runner.ts       Build command, spawn, parse NDJSON, dispatch events
  artifact-handler.ts Video persist, chapters, voiceover trigger
```

### Step 1: sse-writer.ts

Extract lines 528-563. The `SSEWriter` object replaces scattered `writer`/`encoder`/`clientAborted` refs.

```ts
// src/app/api/chat/sse-writer.ts
import { NextRequest } from "next/server";

export interface SSEWriter {
  send(event: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
  readonly aborted: boolean;
  readonly response: Response;
}

export function createSSEWriter(request: NextRequest): SSEWriter {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let aborted = false;

  request.signal.addEventListener("abort", async () => {
    aborted = true;
    try { await writer.close(); } catch {}
  });

  return {
    get aborted() { return aborted; },
    async send(event) {
      if (aborted) return;
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        aborted = true;
      }
    },
    async close() {
      try { await writer.close(); } catch {}
    },
    response: new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }),
  };
}
```

route.ts:
```ts
const sse = createSSEWriter(request);
(async () => {
  // ... all existing logic, replace sendEvent() → sse.send()
  // ... finally { await sse.close(); }
})();
return sse.response;
```

Zero functional change.

### Step 2: validators.ts

Extract lines 580-616 (prompt/image/length validation).

```ts
// src/app/api/chat/validators.ts
import type { ImageAttachment } from "@/lib/types";
import type { AspectRatio } from "@/lib/aspect-ratio";

export interface ValidatedRequest {
  prompt: string;
  images: ImageAttachment[];
  sessionId?: string;
  model: string;
  aspectRatio: AspectRatio;
  voiceName?: string;
}

export function validateChatBody(body: unknown):
  { ok: true; data: ValidatedRequest } | { ok: false; error: string } {
  // ... same checks as lines 580-616, returns typed result
}
```

Zero functional change.

### Step 3: credit-gate.ts

Extract three concerns:

```ts
// src/app/api/chat/credit-gate.ts

/** Pre-flight: check credits, compute max budget. Lines 619-639. */
export async function checkCredits(
  userId: string,
  serviceClient: SupabaseClient,
): Promise<{ credits: number; maxBudgetUsd: number } | { error: string }>;

/** Mid-run: track token usage per assistant message ID. Lines 1173-1210. */
export class UsageTracker {
  constructor(model: string);
  recordAssistant(msgId: string, usage: Partial<TokenUsage>): void;
  recordFinal(usage: TokenUsage): void;
  get estimatedCost(): number;
  get finalCost(): number;
  get finalUsage(): TokenUsage;
  shouldSendEstimate(intervalMs: number): boolean;
}

/** Post-run: idempotent debit. Lines 1630-1665 + 1773-1788. */
export async function debitCredits(opts: {
  serviceClient: SupabaseClient;
  userId: string;
  runId: string;
  cost: number;
  sessionId?: string;
  description: string;
}): Promise<boolean>;
```

Zero functional change. Idempotency key `run-{runId}` preserved.

### Step 4: cli-runner.ts

Extract command building (lines 1077-1098) and the `onStdout`/`onStderr` handlers (lines 1155-1410).

```ts
// src/app/api/chat/cli-runner.ts

export interface CLIRunOptions {
  sandbox: Sandbox;
  projectPath: string;
  prompt: string;
  portkeyModel: string;
  maxBudgetUsd: number;
  resumeSessionId?: string;
  needsSseFix: boolean;
  timeoutMs: number;
}

export interface CLIEventHandlers {
  onStateChange(state: "planning" | "coding" | "rendering"): void;
  onActivity(event: Partial<SSEEvent>): Promise<void>;
  onSessionId(id: string): void;
  onUsage(msgId: string, usage: Partial<TokenUsage>): void;
  onFinalUsage(usage: TokenUsage): void;
  onBudgetExceeded(): Promise<void>;
  onRenderProgress(percent: number): Promise<void>;
}

export interface CLIResult {
  exitCode: number;
  timedOut: boolean;
  budgetExceeded: boolean;
  fullOutput: string;
  claudeSessionId: string;
}

export async function runCLI(
  opts: CLIRunOptions,
  handlers: CLIEventHandlers,
): Promise<CLIResult>;
```

Zero functional change. Same command string, same NDJSON parsing via `parseNDJSONChunk`.

### Step 5: artifact-handler.ts

Extract lines 1510-1560 (video persist, chapter extract, voiceover trigger).

```ts
// src/app/api/chat/artifact-handler.ts

export async function finalizeArtifacts(opts: {
  sandbox: Sandbox;
  sandboxId: string;
  sessionId: string;
  userId: string;
  preRunFingerprint: string | null;
  origin?: string;
  cookie?: string;
}): Promise<{ videoUrl: string | null; isNewVideo: boolean }>;
```

Zero functional change.

### Resulting route.ts (~100 lines)

```ts
export async function POST(request: NextRequest): Promise<Response> {
  // Auth (lines 497-509)
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(..., { status: 401 });

  const serviceClient = createServiceClient();
  const sse = createSSEWriter(request);

  (async () => {
    try {
      // Validate
      const v = validateChatBody(await request.json());
      if (!v.ok) { await sse.send({ type: "error", message: v.error }); return; }

      // Credits
      const credits = await checkCredits(user.id, serviceClient);
      if ("error" in credits) { await sse.send({ type: "error", message: credits.error }); return; }

      // Sandbox resolution (keep inline — complex fallback logic with candidates)
      const { sandbox, sandboxId, sandboxSource } = await resolveSandbox(...);

      // Run CLI
      const tracker = new UsageTracker(v.data.model);
      const result = await runCLI(
        { sandbox, projectPath, prompt, ... },
        { onActivity: (e) => sse.send(e), onUsage: (id, u) => tracker.recordAssistant(id, u), ... },
      );

      // Handle failure
      if (result.exitCode !== 0) { /* error handling */ return; }

      // Artifacts
      const { videoUrl } = await finalizeArtifacts({ sandbox, sandboxId, ... });

      // Debit
      await debitCredits({ serviceClient, userId: user.id, runId, cost: tracker.finalCost, ... });

      // Complete
      await sse.send({ type: "complete", video_url: videoUrl, ... });
    } catch (error) {
      // ... error handling
    } finally {
      // Fallback debit (idempotent)
      if (tracker.finalCost > 0 && runId) await debitCredits({ ... });
      await sse.close();
    }
  })();

  return sse.response;
}
```

**Note**: Sandbox resolution (the candidates loop at lines 830-911) stays in route.ts for now. It has complex session/snapshot/mapping fallback logic that doesn't fit cleanly into a single function without passing 10+ params.

---

## 2. Typed SSE client hook

`page.tsx:1027-1114` has ~90 lines of manual `reader.read()` / buffer split / `JSON.parse` / dispatch.

### useSSEChat.ts

```ts
// src/hooks/useSSEChat.ts
import { useCallback, useRef } from "react";
import type { SSEEvent } from "@/lib/types";

export function useSSEChat() {
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (
    body: Record<string, unknown>,
    onEvent: (event: SSEEvent) => void,
  ) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try { onEvent(JSON.parse(line.slice(5).trimStart())); } catch {}
      }
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { send, cancel };
}
```

### In page.tsx

Replace lines 1002-1120 with:

```ts
const { send, cancel } = useSSEChat();

// Submit handler
await send(
  { prompt, session_id: sessionId, model, images, aspect_ratio: aspectRatio },
  (event) => handleSSEEvent(event, turnId),
);

// Extracted from the inline switch block
function handleSSEEvent(event: SSEEvent, turnId: string) {
  if (event.sandbox_id) dispatch({ type: "SET_SESSION", sandboxId: event.sandbox_id });
  if (event.claude_session_id) dispatch({ type: "SET_SESSION", claudeSessionId: event.claude_session_id });

  switch (event.type) {
    case "system_init":
      addActivity({ type: "system_init", message: event.message, ... }, turnId);
      break;
    case "tool_use":
      addActivity({ type: "tool_use", ... }, turnId);
      handleToolWriteDispatch(event);
      break;
    case "progress":
      dispatch({ type: "SET_STATUS", statusMessage: ... });
      break;
    case "complete":
      if (event.video_url) dispatch({ type: "SET_VIDEO_URL", url: event.video_url, bumpNonce: true });
      break;
    case "error":
      dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: event.message, isError: true });
      break;
    case "credit_update":
      dispatch({ type: "SET_CREDITS", credits: event.credits_used, estimated: event.credits_estimated });
      break;
  }
}
```

Zero functional change. Same fetch, same parsing, same dispatches.

---

## 3. External model registry

`portkey.ts:57-70` has a hardcoded `MODEL_REGISTRY` object. Adding a model = code change + deploy.

### models.json

```json
[
  {
    "id": "claude-opus-4-6",
    "portkeyModel": "@magent/claude-opus-4-6",
    "label": "Claude Opus 4.6",
    "pricing": {
      "input_tokens": 5,
      "output_tokens": 25,
      "cache_creation_input_tokens": 6.25,
      "cache_read_input_tokens": 0.5
    },
    "nonClaude": false,
    "needsSseFix": false
  },
  {
    "id": "kimi-k2.5",
    "portkeyModel": "@moonshot/kimi-k2.5",
    "label": "Kimi K2.5",
    "pricing": {
      "input_tokens": 0.6,
      "output_tokens": 3,
      "cache_creation_input_tokens": 0.6,
      "cache_read_input_tokens": 0.1
    },
    "nonClaude": true,
    "needsSseFix": true
  }
]
```

### portkey.ts change

```ts
import modelsData from "./models.json";

interface ModelEntry {
  id: string;
  portkeyModel: string;
  label: string;
  pricing: TokenUsage;
  nonClaude?: boolean;
  needsSseFix?: boolean;
}

const MODEL_REGISTRY = new Map<string, ModelEntry>(
  (modelsData as ModelEntry[]).map(m => [m.id, m])
);

// All existing exports unchanged — resolvePortkeyModel, estimateCostUsd, etc.
// They read from MODEL_REGISTRY.get() instead of plain object bracket access.
```

Zero functional change. Same pricing, same routing. Future benefit: add models by editing JSON.

---

## 4. SSE event IDs

Current SSE output:
```
data: {"type":"progress","state":"planning","message":"Planning..."}\n\n
```

Add monotonic `id:` line:
```
id: 0
data: {"type":"progress","state":"planning","message":"Planning..."}\n\n
```

### Change in sse-writer.ts

```ts
export function createSSEWriter(request: NextRequest): SSEWriter {
  let seq = 0;
  // ...
  return {
    async send(event) {
      if (aborted) return;
      const id = seq++;
      try {
        await writer.write(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`));
      } catch { aborted = true; }
    },
    // ...
  };
}
```

### Frontend impact

None. The parser at `page.tsx:1041` does `if (!line.startsWith("data:")) continue` — it already skips non-data lines including `id:`.

### Future value

If we later switch to `EventSource` (instead of `fetch`), browsers auto-send `Last-Event-ID` on reconnect. The server can replay from a ring buffer. Not needed now, but the `id:` field costs nothing to add.

Zero functional change.

---

## 5. Durable session-to-sandbox mapping

`e2b.ts:44` has `sessionToSandboxMap = new Map<string, string>()`. Used at route.ts:838:

```ts
const mappedId = requestClaudeSessionId
  ? getSandboxForSession(requestClaudeSessionId)
  : undefined;
```

This is a **fallback** when the primary `sandbox_id` from the request fails to connect. If the Next.js process restarts or scales horizontally, the map is lost.

### Replace with Supabase query

The `sessions` table already stores `sandbox_id` and `claude_session_id` (updated at route.ts:1597). Query it instead:

```ts
// src/lib/e2b.ts — replace getSandboxForSession

export async function getSandboxForSession(
  claudeSessionId: string,
  serviceClient: SupabaseClient,
): Promise<string | undefined> {
  const { data } = await serviceClient
    .from("sessions")
    .select("sandbox_id")
    .eq("claude_session_id", claudeSessionId)
    .not("sandbox_id", "is", null)
    .order("last_user_activity_at", { ascending: false })
    .limit(1)
    .single();
  return data?.sandbox_id ?? undefined;
}
```

Remove `storeSessionMapping()` — the `sessions` table update at route.ts:1614-1621 already persists this.

Remove `sessionToSandboxMap` and `removeSessionMapping()`.

### Latency

Adds ~5-20ms per request for the Supabase query. This runs once at task start, in the fallback path only (primary sandbox ID usually works). Acceptable.

### prewarmedSandboxes

Keep in-memory for now. Prewarm is a per-instance optimization — if the process restarts, losing prewarms is fine. Multi-instance scaling can address this later.

Minimal functional change: same fallback behavior, now survives restarts.

---

## Execution Order

| # | Change | Risk | Effort | Depends on |
|---|--------|------|--------|------------|
| 1 | Split route.ts (5 modules) | None | Medium | — |
| 2 | useSSEChat hook | None | Small | — |
| 3 | models.json registry | None | Small | — |
| 4 | SSE event IDs | None | Tiny | #1 |
| 5 | Durable session maps | Low | Small | — |

All ship as independent PRs except #4 (needs sse-writer.ts from #1).
