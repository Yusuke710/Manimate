# Agent Stall Investigation

**Date:** 2026-02-19
**Symptom:** Agent goes silent mid-session; user types "continue" and gets a fresh "Manimate initialized" instead of resuming.

## Root Cause

**Vercel serverless timeout** was the primary culprit. The chat route had no `maxDuration` export, so Vercel applied its default (60s hobby / 300s pro). Agent sessions routinely exceed this during multi-step file editing inside E2B sandboxes.

## Timeout Chain (before fix)

| Timeout | Value | Source |
|---------|-------|--------|
| **Vercel serverless** | **60s / 300s** | No `maxDuration` configured |
| Portkey API per-call | 600s (10 min) | `env.API_TIMEOUT_MS` in `portkey.ts` |
| CLI command | 1200s (20 min) | `COMMAND_TIMEOUT_MS` in `timeouts.ts` |
| E2B sandbox idle | 1800s (30 min) | `DEFAULT_SANDBOX_TIMEOUT_MS` (1.5x command) |

Vercel fires first, silently killing the SSE stream. The frontend treats unexpected EOF as normal completion (no error toast). The orphaned CLI process keeps running inside E2B, but when the user sends a new message, `--resume` conflicts with the still-running process, falling back to a fresh session.

## Contributing Factors

1. **No SSE heartbeat** - events only sent on real CLI output; long tool executions cause silence
2. **No `maxDuration` export** - relying on Vercel's low defaults
3. **No per-gap inactivity timeout** - stream loop waits forever if CLI hangs
4. **Frontend treats unexpected EOF as normal end** - no "connection lost" indicator
5. **Sandbox pausing** - E2B auto-pauses after idle timeout, explaining "initialized" vs "reconnected"

## Fix Applied

| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Added `export const maxDuration = 800` |
| `src/app/api/voiceover/route.ts` | Added `export const maxDuration = 800` |
| `src/lib/timeouts.ts` | `COMMAND_TIMEOUT_MINUTES`: 20 -> 12 |

### Aligned Timeout Chain (after fix)

| Timeout | Value |
|---------|-------|
| CLI command | 720s (12 min) |
| Vercel maxDuration | 800s (13m 20s) |
| E2B sandbox idle | 1080s (18 min) |

The CLI command timeout now fits within Vercel's `maxDuration` with an 80s buffer. E2B sandbox outlives both, giving users time to inspect outputs.

### Vercel `maxDuration` Limits (Dec 2025)

- **Fluid enabled (default):** Hobby 300/300, Pro 300/800, Enterprise 300/800 (default/max seconds)
- **Fluid disabled:** Hobby 10/60, Pro 15/300, Enterprise 15/900

## Remaining Gaps (not yet fixed)

- **No SSE heartbeat**: Could add periodic `data: {"type":"ping"}\n\n` to keep the connection alive during long tool executions
- **No unexpected-EOF detection in frontend**: `reader.read()` returning `done === true` should show a "connection lost" toast and offer retry
- **No polling fallback**: If Realtime subscription drops, no recovery mechanism
