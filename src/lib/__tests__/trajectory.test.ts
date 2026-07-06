import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

let fakeHome = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    default: { ...actual, homedir: () => fakeHome },
    homedir: () => fakeHome,
  };
});

async function loadTranscripts(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  vi.resetModules();
  return import("@/lib/local/trajectory");
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }
  vi.resetModules();
});

describe("copyAgentTranscript", () => {
  it("copies the Claude Code transcript using the encoded-cwd directory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-transcripts-"));
    fakeHome = path.join(tmp, "home");
    const localRoot = path.join(tmp, "manimate");

    try {
      const transcripts = await loadTranscripts(localRoot);

      const projectDir = path.join(localRoot, "sessions", "sess-1", "project");
      fs.mkdirSync(projectDir, { recursive: true });

      // Claude Code replaces every non-alphanumeric char in the cwd with "-".
      const encoded = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, "-");
      const transcriptDir = path.join(fakeHome, ".claude", "projects", encoded);
      fs.mkdirSync(transcriptDir, { recursive: true });
      fs.writeFileSync(
        path.join(transcriptDir, "agent-abc.jsonl"),
        '{"type":"user"}\n'
      );

      const copied = await transcripts.copyAgentTranscript({
        sessionId: "sess-1",
        runId: "run-1",
        model: "claude",
        cwd: projectDir,
        agentSessionId: "agent-abc",
      });

      const expected = path.join(localRoot, "sessions", "sess-1", "transcripts", "run-1.jsonl");
      expect(copied).toBe(expected);
      expect(fs.readFileSync(expected, "utf8")).toBe('{"type":"user"}\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds the Codex rollout file by session id anywhere under ~/.codex/sessions", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-transcripts-"));
    fakeHome = path.join(tmp, "home");
    const localRoot = path.join(tmp, "manimate");

    try {
      const transcripts = await loadTranscripts(localRoot);

      const dayDir = path.join(fakeHome, ".codex", "sessions", "2026", "07", "06");
      fs.mkdirSync(dayDir, { recursive: true });
      fs.writeFileSync(
        path.join(dayDir, "rollout-2026-07-06T12-00-00-codex-xyz.jsonl"),
        '{"type":"session_meta"}\n'
      );

      const copied = await transcripts.copyAgentTranscript({
        sessionId: "sess-2",
        runId: "run-2",
        model: "codex",
        cwd: path.join(localRoot, "sessions", "sess-2", "project"),
        agentSessionId: "codex-xyz",
      });

      const expected = path.join(localRoot, "sessions", "sess-2", "transcripts", "run-2.jsonl");
      expect(copied).toBe(expected);
      expect(fs.readFileSync(expected, "utf8")).toBe('{"type":"session_meta"}\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null without failing when no transcript exists", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-transcripts-"));
    fakeHome = path.join(tmp, "home");

    try {
      const transcripts = await loadTranscripts(path.join(tmp, "manimate"));
      const copied = await transcripts.copyAgentTranscript({
        sessionId: "sess-3",
        runId: "run-3",
        model: "claude",
        cwd: path.join(tmp, "nowhere"),
        agentSessionId: "missing",
      });
      expect(copied).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
