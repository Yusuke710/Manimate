# Prompt Caching with CLAUDE.md

This document explains how Magent achieves automatic prompt caching through `CLAUDE.md` files and the `claude -p` command.

## Overview

Magent leverages Anthropic's native prompt caching to reduce costs and latency when running Claude Code in E2B sandboxes. Claude Code automatically detects `CLAUDE.md` files and includes them as system context. When the same content is sent repeatedly, Anthropic's API caches it and charges only 10% for subsequent requests.

```
┌─────────────────────────────────────────────────────────────┐
│                    E2B Sandbox                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  /home/user/                                         │   │
│  │  ├── CLAUDE.md  ← ~124KB system context             │   │
│  │  └── <sandbox-id>/                                   │   │
│  │       └── user project files                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│          claude -p '<small user prompt>'                   │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Anthropic API                              │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │ Cached Context  │ +  │ User Prompt                 │    │
│  │ (10% cost)      │    │ (100% cost)                 │    │
│  └─────────────────┘    └─────────────────────────────┘    │
│                                                             │
│  Result: ~90% cost reduction on context tokens              │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. CLAUDE.md Baked into Docker Image

The `CLAUDE.md` file containing system context is copied into the E2B sandbox during image build:

```dockerfile
# From e2b.Dockerfile
COPY e2b/CLAUDE.md /home/user/CLAUDE.md
RUN chown user:user /home/user/CLAUDE.md
```

This places the ~124KB system context file in the sandbox's home directory where Claude Code automatically discovers it.

### 2. Claude Code Automatic Detection

When Claude Code runs in any directory, it automatically looks for `CLAUDE.md` files:
- In the current directory
- In parent directories (walks up the tree)
- In the user's home directory (`~`)

The content becomes part of the system prompt for that session.

### 3. The `claude -p` Command

The chat API invokes Claude Code with the `-p` flag for non-interactive prompt execution:

```bash
claude --print --output-format stream-json --verbose --model opus \
       --dangerously-skip-permissions -p '<user prompt>'
```

Key flags:
- `--print` - Output to stdout for streaming
- `--output-format stream-json` - NDJSON format for real-time events
- `--model opus` - Uses Claude Opus (pricing varies by model)
- `--dangerously-skip-permissions` - Skip prompts in sandbox environment
- `-p '<prompt>'` - The actual user request (small, ~1KB)

### 4. Anthropic's Native Prompt Caching

Anthropic automatically caches repeated content in API requests. This is **content-based caching**, not file-level caching:

1. **First request**: Full context sent → `cache_creation_input_tokens` charged at 100%
2. **Subsequent requests**: Identical content retrieved from cache → `cache_read_input_tokens` charged at **10%**

**Important caching details:**
- Cache is keyed by the exact content, model, and organization
- Cache has a TTL (time-to-live) - typically 5 minutes of inactivity
- Any change to the `CLAUDE.md` content invalidates the cache
- Cache is per-model: switching models creates a new cache entry

The large `CLAUDE.md` content gets cached after the first request, and all subsequent requests with identical content reuse the cached version.

## Session Continuation with `--resume`

For multi-turn conversations, Claude Code supports session resumption:

```bash
# First message - creates session
claude -p 'Create a spinning cube animation'
# Returns: session_id: "abc123"

# Subsequent messages - resume session
claude --resume abc123 -p 'Make it bounce instead'
```

The `--resume` flag maintains conversation context without resending the full system prompt.

**Note:** Session resumption requires the same sandbox instance. Session IDs are stored locally in the sandbox and cannot be transferred between sandboxes.

## Cost Savings

### How Caching Reduces Costs

Anthropic's prompt caching provides significant savings on repeated content:

| Token Type | First Request | Subsequent Requests |
|------------|---------------|---------------------|
| Cache creation | 100% cost | - |
| Cache read | - | 10% cost |
| Regular input | 100% cost | 100% cost |
| Output | 100% cost | 100% cost |

The ~124KB CLAUDE.md file translates to roughly 25,000-30,000 tokens of system context. With caching, subsequent requests only pay 10% for this context.

### Real-world Results

Testing showed high cache hit rates after warm-up:
- First request: Full cost for context (cache creation)
- Subsequent requests within TTL: 10% cost for context (cache read)

**Note:** Cache hit rates depend on usage patterns. Idle periods longer than the cache TTL will result in cache misses.

## Implementation Details

### Token Usage Tracking

The API captures cache token metrics from Claude Code's output:

```typescript
if (obj.type === "result" && obj.usage) {
  const usage = obj.usage as {
    input_tokens?: number;           // Regular input
    output_tokens?: number;          // Model output
    cache_creation_input_tokens?: number;  // Cache miss (100% cost)
    cache_read_input_tokens?: number;      // Cache hit (10% cost)
  };
}
```

### Evolution of the Caching Strategy

1. **Initial**: Large prompts passed on every API call (high cost)
2. **Optimization 1**: Move `CLAUDE.md` to Docker image, use LiteLLM `cache_control_injection_points`
3. **Current**: Remove LiteLLM config entirely - Anthropic + Claude Code handle caching automatically

The simplified approach proved more reliable. Claude Code and Anthropic's API handle prompt caching automatically without explicit configuration.

## Files Involved

| File | Purpose |
|------|---------|
| `e2b/CLAUDE.md` | System context (~124KB) - domain knowledge, best practices |
| `e2b.Dockerfile` | Builds sandbox image with CLAUDE.md |
| `src/app/api/chat/route.ts` | Invokes `claude -p` and handles streaming |

## Best Practices

1. **Keep CLAUDE.md static**: Avoid dynamic content in `CLAUDE.md` as it invalidates the cache
2. **Use session resumption**: Always pass `--resume` for follow-up messages within the same sandbox
3. **Small user prompts**: Keep the `-p` argument small; large context goes in `CLAUDE.md`
4. **Monitor cache rates**: Watch `cache_read_input_tokens` vs `cache_creation_input_tokens`
5. **Consistent model usage**: Stick to one model to maximize cache hits

## Debugging

Check cache effectiveness in the logs:

```
[Usage] Tokens: input=1234 (raw=234, cache_create=0, cache_read=1000)
```

- `cache_read > 0` = Cache is working
- `cache_create > 0` = Cache miss (expected on first request or after TTL expiry)
- `raw` only = No caching (check CLAUDE.md placement)

### Common Cache Miss Causes

1. **TTL expiry**: No requests for ~5 minutes
2. **Content change**: Any modification to CLAUDE.md
3. **Model switch**: Using a different model
4. **New sandbox**: Cache is per-organization, but session context is per-sandbox
