import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

function makeFakeProcess(pid: number): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  emitter.pid = pid;
  emitter.exitCode = null;
  emitter.signalCode = null;
  return emitter;
}

describe("local run registry", () => {
  it("survives module re-instantiation (Next.js dev HMR)", async () => {
    const runtime = await import("@/lib/local/runtime");
    const sessionId = "registry-test-session";
    const sandboxId = "registry-test-sandbox";

    runtime.registerLocalRunProcess({
      sessionId,
      sandboxId,
      runId: "registry-test-run",
      process: makeFakeProcess(999_999),
    });

    try {
      // Simulate HMR: drop the module instance and re-import.
      vi.resetModules();
      const reloaded = await import("@/lib/local/runtime");

      const entry = reloaded.getActiveLocalRunBySessionId(sessionId);
      expect(entry?.sandboxId).toBe(sandboxId);
      expect(reloaded.getActiveLocalRunBySandboxId(sandboxId)?.runId).toBe(
        "registry-test-run"
      );
    } finally {
      const reloaded = await import("@/lib/local/runtime");
      reloaded.clearLocalRunProcess(sandboxId);
    }
  });

  it("does not kill a process that is not an agent CLI", async () => {
    const { killOrphanedAgentProcessGroup } = await import("@/lib/local/runtime");
    // Current test process is node/vitest, not claude/codex.
    expect(killOrphanedAgentProcessGroup(process.pid)).toBe(false);
  });

  it("returns false for dead or invalid pids", async () => {
    const { killOrphanedAgentProcessGroup } = await import("@/lib/local/runtime");
    expect(killOrphanedAgentProcessGroup(0)).toBe(false);
    expect(killOrphanedAgentProcessGroup(-5)).toBe(false);
    expect(killOrphanedAgentProcessGroup(2 ** 30)).toBe(false);
  });
});
