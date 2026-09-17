import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { parseNDJSONChunk } from "@/lib/ndjson-parser";

type Event = Record<string, unknown>;

/** A result ends a model turn, not necessarily the work owned by its process. */
export class ClaudeInputLifecycle {
  private tasks = new Set<string>();
  private completedTasks = new Set<string>();
  private awaitingNotificationTurn = false;
  private resultReady = false;
  private terminalError = false;

  get shouldClose(): boolean {
    return this.terminalError || (this.resultReady && this.tasks.size === 0 && !this.awaitingNotificationTurn);
  }

  observe(event: Event): void {
    // Forwarded subagent results must never close the parent conversation.
    if (event.parent_tool_use_id) return;
    if (event.type === "system") {
      const id = typeof event.task_id === "string" ? event.task_id : null;
      if (event.subtype === "background_tasks_changed" && Array.isArray(event.tasks)) {
        // Empty snapshots can precede terminal notifications. Retain removed
        // IDs until notified so a result between the two cannot close stdin.
        for (const task of event.tasks as Event[]) {
          if (typeof task.task_id === "string" && !this.completedTasks.has(task.task_id)) {
            this.tasks.add(task.task_id);
          }
        }
      }
      if (event.subtype === "task_started" && event.is_backgrounded === true && id && !this.completedTasks.has(id)) {
        this.tasks.add(id);
      }
      if (event.subtype === "task_notification" && id) {
        this.tasks.delete(id);
        this.completedTasks.add(id);
        this.awaitingNotificationTurn = true;
        this.resultReady = false;
      }
      return;
    }
    if (event.type === "assistant" || event.type === "user") this.resultReady = false;
    // Also recognize auto-backgrounded Bash calls from their structured result.
    if (event.type === "user") {
      const result = event.tool_use_result as Event | undefined;
      const id = result?.backgroundTaskId;
      if (typeof id === "string" && !this.completedTasks.has(id)) this.tasks.add(id);
      return;
    }
    if (event.type !== "result") return;
    this.terminalError = event.is_error === true || String(event.subtype).startsWith("error");
    const queued = typeof event.queued_turn_count === "number" ? event.queued_turn_count : 0;
    const origin = event.origin as Event | undefined;
    // A notification can be consumed within an existing foreground turn, or
    // trigger its own turn. queued_turn_count covers both, including batching.
    if (event.queued_turn_count === 0 || (origin?.kind === "task-notification" && queued === 0)) {
      this.awaitingNotificationTurn = false;
    }
    this.resultReady = queued === 0;
  }
}

/** Keep stdin open for native completion notifications; no synthetic user turns. */
export function attachClaudeInput(child: ChildProcessWithoutNullStreams, prompt: string): void {
  const lifecycle = new ClaudeInputLifecycle();
  let buffer = "";
  let closeInput: ReturnType<typeof setImmediate> | undefined;
  const onData = (chunk: Buffer) => {
    if (closeInput) clearImmediate(closeInput);
    closeInput = undefined;
    const parsed = parseNDJSONChunk(buffer, chunk.toString("utf8"));
    buffer = parsed.remainder;
    for (const event of parsed.lines as Event[]) lifecycle.observe(event);
    if (lifecycle.shouldClose && !buffer.trim()) {
      // Let events already buffered with a result reach the lifecycle first.
      closeInput = setImmediate(() => {
        if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
      });
    }
  };
  child.stdout.on("data", onData);
  child.once("close", () => {
    if (closeInput) clearImmediate(closeInput);
    child.stdout.off("data", onData);
  });
  // A user cancellation can close the pipe while the initial input is written.
  child.stdin.on("error", () => {});
  child.stdin.write(JSON.stringify({
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
    session_id: "",
  }) + "\n");
}
