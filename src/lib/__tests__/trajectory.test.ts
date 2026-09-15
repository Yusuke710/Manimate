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


describe("readSessionTrajectory", () => {
  it.each(["claude", "codex"])("keeps resumed %s history in its original turn, before applying the event limit", async (provider) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-replay-"));
    try {
      const { readSessionTrajectory } = await loadTranscripts(tmp);
      const dir = path.join(tmp, "sessions", "session", "transcripts");
      fs.mkdirSync(dir, { recursive: true });
      const line = (text: string, timestamp: string) => JSON.stringify(provider === "claude"
        ? { type: "assistant", timestamp, message: { content: [{ type: "text", text }] } }
        : { type: "response_item", timestamp, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
      const old = Array.from({ length: 1001 }, (_, i) => line(`Old ${i}`, "2026-09-08T12:00:01Z")).join("\n");
      fs.writeFileSync(path.join(dir, "first.jsonl"), old);
      fs.writeFileSync(path.join(dir, "second.jsonl"), old + "\n" + line("New reply", "2026-09-09T12:00:01Z"));
      const events = readSessionTrajectory("session", [
        { runId: "first", turnId: "user-1", createdAt: "2026-09-08T12:00:00Z" },
        { runId: "second", turnId: "user-2", createdAt: "2026-09-09T12:00:00Z" },
      ]);
      expect(events.filter(event => event.turn_id === "user-2").map(event => event.message)).toEqual(["New reply"]);
      expect(events[0].turn_id).toBe("user-1");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("live transcript recovery", () => {
  it.each(["claude", "codex"])("recovers and updates %s activity before the run is archived", async provider => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-live-trace-"));
    fakeHome = path.join(tmp, "home");
    const root = path.join(tmp, "manimate");
    try {
      const { readSessionDisplayTrajectory } = await loadTranscripts(root);
      const project = path.join(root, "sessions", "live-session", "project");
      const nativeDir = provider === "claude"
        ? path.join(fakeHome, ".claude", "projects", project.replace(/[^a-zA-Z0-9]/g, "-"))
        : path.join(fakeHome, ".codex", "sessions", "2026", "09", "15");
      fs.mkdirSync(nativeDir, { recursive: true });
      const nativeFile = path.join(nativeDir, provider === "claude" ? "agent.jsonl" : "rollout-timestamp-agent.jsonl");
      const line = (text: string) => JSON.stringify(provider === "claude"
        ? { type: "assistant", timestamp: "2026-09-15T12:00:01Z", message: { content: [{ type: "text", text }] } }
        : { type: "response_item", timestamp: "2026-09-15T12:00:01Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } }) + "\n";
      fs.writeFileSync(nativeFile, line("Writing the plan"));
      const runs = [{ runId: "run", turnId: "user", createdAt: "2026-09-15T12:00:00Z", agentSessionId: "agent", active: true }];
      const first = await readSessionDisplayTrajectory("live-session", provider, runs);
      expect(first.filter(event => event.type !== "system_init").map(event => event.message)).toEqual(["Writing the plan"]);
      expect(first[0]).toMatchObject({ type: "system_init", message: "Manimate connected · CLI default" });
      fs.appendFileSync(nativeFile, line("Rendering the animation"));
      const second = await readSessionDisplayTrajectory("live-session", provider, runs);
      expect(second.filter(event => event.type !== "system_init").map(event => event.message)).toEqual(["Writing the plan", "Rendering the animation"]);
      expect(second.every(event => event.turn_id === "user")).toBe(true);
      expect(fs.existsSync(path.join(root, "sessions", "live-session", "transcripts"))).toBe(false);
      // A completed run switches to its durable archive.
      const archiveDir = path.join(root, "sessions", "live-session", "transcripts");
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.copyFileSync(nativeFile, path.join(archiveDir, "run.jsonl"));
      fs.rmSync(nativeFile);
      expect(await readSessionDisplayTrajectory("live-session", provider, [{ ...runs[0], active: false }])).toEqual(second);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});
