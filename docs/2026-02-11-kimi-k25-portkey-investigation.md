# Kimi K2.5 via Portkey on Claude Code CLI — Investigation Report

**Date**: 2026-02-11
**Status**: Working with workaround — Kimi API bug is mitigated in-app for tool-use workflows

## Goal

Add Kimi K2.5 (Moonshot AI) as an alternative model in Magent alongside Claude Opus 4.6, routed through Portkey API gateway, using Claude Code CLI in E2B sandboxes.

## Architecture: Portkey Model String Composition

### Problem

Claude Code CLI v2.1.34+ does **NOT** forward `ANTHROPIC_CUSTOM_HEADERS` in any mode (interactive, `--print`, `stream-json`). This means the previous approach of setting Portkey routing headers via env vars doesn't work.

### Solution

Use Portkey's **model string composition** format:

```
--model @provider_slug/model_name
```

Portkey extracts the provider from the `@prefix`, so no custom headers are needed. Examples:
- `--model @magent/claude-opus-4-6` → routes through Portkey to the `@magent` provider (Anthropic)
- `--model @moonshot/kimi-k2.5` → routes through Portkey to the `@moonshot` provider (Moonshot AI)

Both use the same env vars:
```
ANTHROPIC_BASE_URL=https://api.portkey.ai
ANTHROPIC_AUTH_TOKEN=<portkey_api_key>
```

### Portkey Dashboard Setup

Created `@moonshot` provider in Portkey dashboard:
- Base URL: `https://api.moonshot.ai/anthropic/v1`
- API key: Moonshot API key
- Provider slug: `@moonshot`

Why `/v1` is required:
- Moonshot's valid Anthropic-compatible route is `POST /anthropic/v1/messages`
- `POST /anthropic/messages` returns 404
- `POST /anthropic/v1/v1/messages` returns 404

## Code Changes

### 1. `src/lib/portkey.ts` — Model routing module (rewritten)

- **`MODEL_REGISTRY`**: Maps UI model IDs to Portkey model strings with `@provider/model` format
- **`resolvePortkeyModel()`**: Resolves UI model ID to Portkey string (e.g., `"kimi-k2.5"` → `"@moonshot/kimi-k2.5"`)
- **`getSandboxEnvVars()`** (renamed from `getPortkeyEnvVars`): No longer uses `ANTHROPIC_CUSTOM_HEADERS`; sets compatibility flags for non-Claude models
- **`nonClaude` flag**: Non-Claude models get extra env vars:
  ```
  ANTHROPIC_SMALL_FAST_MODEL=@moonshot/kimi-k2.5
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
  MAX_THINKING_TOKENS=0
  DISABLE_INTERLEAVED_THINKING=1
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
  API_TIMEOUT_MS=600000
  ```

### 2. `src/lib/e2b.ts` — Import update

Changed `getPortkeyEnvVars` → `getSandboxEnvVars`.

### 3. `src/app/api/chat/route.ts` — Model resolution

- Uses `resolvePortkeyModel(resolvedModel)` for `--model` flag
- Removed inline `runtimeEnvPrefix` (env vars now set at sandbox creation)
- Removed CLAUDE.md swap code for non-Claude models (proved unnecessary)

### 4. `e2b.Dockerfile` — Cache-busting

Added `ARG CLAUDE_CLI_VERSION=2.1.39` to pin the CLI version and bust Docker cache. The ARG is used in `npm install -g @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}`.

### 5. `src/lib/kimi-sse-fix-script.ts` + `src/app/api/chat/route.ts` — Runtime SSE repair workaround

Implemented a Kimi-specific streaming shim to repair malformed SSE frames before Claude Code consumes them:

- New file: `src/lib/kimi-sse-fix-script.ts`
  - Exports `KIMI_SSE_FIX_SCRIPT` (fetch interceptor)
  - Detects Kimi streaming requests (`model: @moonshot/kimi-k2.5`)
  - Tracks open content block indexes from `content_block_start`
  - Injects synthetic `content_block_stop` events for any unclosed blocks before `message_delta`/`message_stop`

- `src/lib/portkey.ts`
  - Added `needsSseFix` model flag in `MODEL_REGISTRY`
  - Added `modelNeedsSseFix()` helper

- `src/app/api/chat/route.ts`
  - Writes shim into sandbox as `/tmp/magent-kimi-sse-fix.mjs`
  - Enables shim only for `needsSseFix` models via:
    - `NODE_OPTIONS=--import=/tmp/magent-kimi-sse-fix.mjs`
  - Keeps behavior model-scoped (Claude models unaffected)

## Investigation: Why Kimi K2.5 Returns "(no content)"

### Symptom

- Text-only prompts like "Say hello" work fine — Kimi returns text responses
- Tool-use prompts like "Draw a simple blue circle" return empty results — tokens consumed but no assistant message emitted
- Observed in both sandbox (E2B) and local (`claude -p`) environments

### Hypotheses Tested and Disproved

| Hypothesis | Test | Result |
|---|---|---|
| CLAUDE.md too large (123KB) | Tested locally with same CLAUDE.md | Kimi handled 50K input tokens fine |
| CLI version too old (2.1.22) | Rebuilt template, got v2.1.39 | Still failed |
| Prompt format ("Project Directory" prefix) | Tested with/without prefix, empty dir | Still failed |

### Root Cause: Missing `content_block_stop` for `tool_use` Blocks

Captured raw SSE stream using a fetch interceptor (`/tmp/portkey-sse-tap.mjs`):

```javascript
// NODE_OPTIONS="--import /tmp/portkey-sse-tap.mjs" claude -p "Draw a blue circle"
```

**Expected SSE lifecycle (per Anthropic spec):**
```
message_start
  content_block_start  (index=0, text)
  content_block_delta  (text deltas...)
  content_block_stop   (index=0)      ← closes text block
  content_block_start  (index=1, tool_use)
  content_block_delta  (JSON deltas...)
  content_block_stop   (index=1)      ← closes tool_use block
message_delta (stop_reason)
message_stop
```

**Actual Kimi SSE output:**
```
message_start
  content_block_start  (index=0, text, empty)
  content_block_start  (index=1, tool_use: Write)
  content_block_delta  (index=1, ~160 JSON chunks with matplotlib code)
  content_block_stop   (index=0)      ← ONLY closes the empty text block
message_delta (stop_reason: end_turn)
message_stop
```

**The `content_block_stop` for index=1 (the tool_use block) is NEVER emitted.**

Claude Code CLI only emits assistant messages in `stream-json` mode at `content_block_stop` events. Without this event for the tool_use block, the entire tool call is silently swallowed — tokens are consumed (197 output tokens) but no assistant message or tool_use event appears in the output.

### Evidence

Raw SSE log at `/tmp/kimi-sse.log` shows the exact event sequence above.

## Status and Verification

1. **Claude Opus 4.6**: Works perfectly end-to-end through the full pipeline
2. **Kimi K2.5 text responses**: Work fine (tested with "Say hello")
3. **Kimi K2.5 tool_use/agentic**: Works in Magent with shim; upstream Moonshot stream bug still exists

### Server-side proof (not just UI labels)

Verified from database activity events:
- `sessions.model = "kimi-k2.5"`
- `activity_events.type = "system_init"` payload contains:
  - `model: "@moonshot/kimi-k2.5"`
- Same run includes persisted `tool_use` events (`Bash`, `Write`, etc.), confirming agentic flow executed server-side

### Automated tests added

- `src/lib/__tests__/portkey.test.ts`
- `src/lib/__tests__/kimi-sse-fix-script.test.ts`
- `src/lib/__tests__/kimi-sse-fix-runtime.test.ts`

## Remaining Risk and Next Steps

- **Moonshot still has a protocol bug**: The root cause remains upstream; our fix is a compatibility shim.
- **Keep bug report open with Moonshot**: Their Anthropic-compatible endpoint must emit `content_block_stop` for all started blocks.
- **When Moonshot fixes it**: Remove `needsSseFix` for Kimi and delete the shim path.
