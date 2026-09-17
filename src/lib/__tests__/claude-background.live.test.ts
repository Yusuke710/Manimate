import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { spawnLocalAgentProcess } from "@/lib/local/runtime";

// Explicit opt-in: runs the authenticated Claude CLI and consumes usage.
it.skipIf(process.env.MANIMATE_LIVE_CLAUDE !== "1")("receives background completion and resumes through the real launcher", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "manimate-background-"));
  await writeFile(join(cwd, "job.py"), 'import time\nfrom pathlib import Path\ntime.sleep(20)\nPath("completed.txt").write_text("BACKGROUND_OK")\nprint("BACKGROUND_OK")\n');
  async function run(prompt: string, resumeSessionId?: string) {
    const child = spawnLocalAgentProcess({ cwd, prompt, resumeSessionId });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.resume();
    const timer = setTimeout(() => { if (child.pid) process.kill(-child.pid, "SIGKILL"); }, 100_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(code).toBe(0);
      return stdout.trim().split("\n").map(line => JSON.parse(line));
    } finally { clearTimeout(timer); }
  }
  const first = await run("Remember the token MARIGOLD. Reply with that token only; do not use tools.");
  const sessionId = first.find(event => event.session_id)?.session_id;
  expect(sessionId).toBeTruthy();
  const events = await run("Run python3 job.py exactly once using Bash with run_in_background=true. Immediately reply that you are waiting, without polling or using TaskOutput. When the native completion notification arrives, report the job result and the token I asked you to remember.", sessionId);
  const results = events.filter(event => event.type === "result");
  expect(results.length).toBeGreaterThanOrEqual(2);
  expect(events.some(event => event.subtype === "task_notification" && event.status === "completed")).toBe(true);
  expect(results.at(-1).result).toContain("MARIGOLD");
  expect(await readFile(join(cwd, "completed.txt"), "utf8")).toBe("BACKGROUND_OK");
  console.log(JSON.stringify({ cwd, resultCount: results.length, completionReceived: true, historyRetained: true }));
}, 210_000);
