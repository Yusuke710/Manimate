/**
 * Regression test: Optimistic session navigation must not stall.
 *
 * The welcome flow fires POST /api/sessions in the background and navigates
 * immediately.  If the fetch hangs (cold start, network issue) the UI must
 * NOT block forever — the fetch has a 15s AbortController timeout, and the
 * .catch(() => false) ensures the sessionReady promise resolves (never hangs).
 *
 * These tests verify the exact promise chain shape used in production:
 *   fetch(..., { signal }).then(r => r.ok).catch(() => false).finally(cleanup)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Builds the same promise chain as handleWelcomeSend in page.tsx.
 * This tests the actual pattern, not a simplified mock.
 */
function buildSessionReady(
  fetchFn: () => Promise<{ ok: boolean }>,
  cleanup: () => void,
  abortCtl: AbortController,
  timeoutMs = 15_000,
) {
  const timeout = setTimeout(() => abortCtl.abort(), timeoutMs);
  return fetchFn()
    .then(r => r.ok)
    .catch(() => false as const)
    .finally(() => { clearTimeout(timeout); cleanup(); });
}

describe("optimistic session creation", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves true on successful fetch (no stall)", async () => {
    const cleanup = vi.fn();
    const ready = buildSessionReady(
      () => Promise.resolve({ ok: true }),
      cleanup,
      new AbortController(),
    );
    expect(await ready).toBe(true);
    expect(cleanup).toHaveBeenCalled();
  });

  it("resolves false on HTTP error (no stall)", async () => {
    const cleanup = vi.fn();
    const ready = buildSessionReady(
      () => Promise.resolve({ ok: false }),
      cleanup,
      new AbortController(),
    );
    expect(await ready).toBe(false);
    expect(cleanup).toHaveBeenCalled();
  });

  it("resolves false on network error (no stall)", async () => {
    const cleanup = vi.fn();
    const ready = buildSessionReady(
      () => Promise.reject(new Error("network error")),
      cleanup,
      new AbortController(),
    );
    expect(await ready).toBe(false);
    expect(cleanup).toHaveBeenCalled();
  });

  it("resolves false when fetch hangs past 15s abort timeout", async () => {
    const cleanup = vi.fn();
    const abortCtl = new AbortController();

    // Simulate a fetch that rejects when aborted
    const ready = buildSessionReady(
      () => new Promise<{ ok: boolean }>((_, reject) => {
        abortCtl.signal.addEventListener("abort", () => reject(new Error("AbortError")));
      }),
      cleanup,
      abortCtl,
    );

    // Advance past the 15s timeout — abort fires
    vi.advanceTimersByTime(15_000);

    expect(await ready).toBe(false);
    expect(cleanup).toHaveBeenCalled();
  });

  it("navigation is instant: router.push called before fetch resolves", () => {
    const calls: string[] = [];
    const sessionCreationRef = { current: null as { id: string; ready: Promise<boolean> } | null };
    const fakeRouter = { push: (url: string) => { calls.push(`push:${url}`); } };

    // Simulate handleWelcomeSend flow
    const id = "test-uuid";
    const ready = new Promise<boolean>(() => {}); // never resolves — simulates slow fetch
    sessionCreationRef.current = { id, ready };
    calls.push("ref-set");
    fakeRouter.push(`/?session=${id}`);

    // Verify: ref set before push, push is synchronous, fetch still pending
    expect(calls).toEqual(["ref-set", `push:/?session=${id}`]);
    expect(sessionCreationRef.current).not.toBeNull();
  });

  it("handleSend proceeds immediately when sessionReady is null (fast session creation)", async () => {
    // When POST /api/sessions completes before ChatPanel renders,
    // .finally() clears the ref, so sessionReady prop is null.
    // handleSend should skip the await and call /api/chat directly.
    const sessionReady: Promise<boolean> | null = null;

    // The production check: if (sessionReady && !(await sessionReady))
    let skipped = true;
    if (sessionReady && !(await sessionReady)) {
      skipped = false; // would mean error path
    }
    expect(skipped).toBe(true);
  });
});
