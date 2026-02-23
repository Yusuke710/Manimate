# Voiceover Swap Dedup: Debugging a Polling/Realtime Cascade

**Date**: 2026-02-16
**Files**: `src/components/PreviewPanel.tsx`, `src/lib/__tests__/video-voiceover-regression.test.ts`

## The Bug

After a voiceover completed, the silent-to-voiced video swap fired **8+ redundant times** in rapid succession instead of once. Each cycle repeated: VoiceoverFlow detect → `setEffectiveVideoUrl` → `bumpVoicedSwapToken` → VideoSwap effect. The user saw no visible glitch (the double-buffer swap is idempotent), but the console showed a cascade of identical swap operations within the same second.

## Why This Was Hard to Find

1. **Invisible in the UI** — The double-buffer swap design (`<video>` A/B elements) is idempotent. Swapping the same voiced URL eight times looks identical to swapping once. No flicker, no stutter, no visual artifact.

2. **Correct behavior masks the bug** — Every individual swap was "correct": the voiceover *was* completed, the voiced URL *was* valid, and the swap *did* succeed. The bug was purely about redundancy, not incorrectness.

3. **Multiple async sources converge** — The `completed` status arrives through overlapping channels:
   - Polling interval (every 3s) hitting `/api/sessions/:id`
   - Supabase Realtime subscription on `sessions` table
   - SSE stream's `refetchData()` callback
   - React state updates from any of the above

   Each source independently detects `voiceover_status = 'completed'` and triggers the same code path.

4. **React batching makes timing non-deterministic** — Two polls in the same React render batch can both see `prevStatusRef = 'pending'` before either update commits, so the `enteredCompleted` transition check (`wasActive && newStatus === 'completed'`) passes for both.

## How We Tracked It

### Step 1: Live Console Log Observation

During a multi-turn test (quadratic equations → completing the square), we:
- Played turn 1 video to 1:19 / 2:00
- Cleared console logs via Chrome DevTools MCP
- Sent turn 2 prompt
- Waited for turn 2 to complete
- Filtered console for `VoiceoverFlow|VideoSwap`

The logs at `15:34:10` showed the same `[VoiceoverFlow] Voiceover completed, triggering swap` message repeating 8 times with identical payloads, interleaved with `[VideoSwap]` entries.

### Step 2: Source Analysis

Traced the data flow backwards from the swap trigger:

```
PreviewPanel polling effect (line ~80-120)
  → detects voiceover_status transition to 'completed'
  → calls setEffectiveVideoUrl() + bumpVoicedSwapToken()
  → triggers PreviewTab swap effect (line ~818-1065)
```

The polling effect runs on a 3s interval, but Supabase Realtime + SSE refetch also trigger re-renders that restart the effect. The `prevStatusRef` check (`pending/generating → completed`) was supposed to be one-shot, but React batching allowed multiple invocations to see the same stale ref value.

### Step 3: State Machine Regression Tests

Before writing the fix, we built a 46-test state machine model (`video-voiceover-regression.test.ts`) covering:
- Refresh: no double video load from realtime/SSE race
- Silent → voiced swap with seekbar continuity
- Multi-turn video switching
- Reload rehydration
- Session isolation
- Console log contracts

This let us verify the fix wouldn't regress any existing behavior.

## The Fix

Added `voicedSwapFiredRef = useRef(false)` — a one-shot guard per turn:

```typescript
// In the polling effect's completion handler:
if (enteredCompleted && data.last_video_url && !voicedSwapFiredRef.current) {
  voicedSwapFiredRef.current = true;  // Block all subsequent triggers this turn
  setEffectiveVideoUrl(data.last_video_url);
  bumpVoicedSwapToken();
}
```

Reset points:
- **New turn** (sync effect, nonce change): `voicedSwapFiredRef.current = false`
- **Retry** (user clicks retry): `voicedSwapFiredRef.current = false`

## Why Not Other Approaches

| Approach | Problem |
|----------|---------|
| Debounce the polling effect | Adds latency to legitimate first swap |
| Remove Realtime subscription | Breaks other features (plan/code updates) |
| Compare voiced URLs | Same URL can arrive from different sources legitimately |
| Use `useRef` for prevStatus only | React batching means multiple reads of the same stale ref |

The one-shot ref is the simplest solution: it's synchronous (no timing issues), per-turn scoped (resets correctly), and doesn't affect the first swap's latency.

## Test Coverage

49 regression tests covering:
- Batched poll simulation (manually rewind `prevStatusRef` to prove the guard blocks the second trigger)
- Turn-reset verification (nonce change clears the guard)
- Retry-reset verification (retry handler clears the guard)
- All existing flows unchanged (silent→voiced, multi-turn, reload, session isolation)
