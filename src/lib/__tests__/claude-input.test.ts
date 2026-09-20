import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { attachClaudeInput } from "@/lib/local/claude-input";

const result = { type: "result", subtype: "success", queued_turn_count: 0 };
const started = (id: string) => ({ type: "system", subtype: "task_started", task_id: id, is_backgrounded: true });
const done = (id: string, status = "completed") => ({ type: "system", subtype: "task_notification", task_id: id, status });

describe("Claude streaming input lifetime", () => {

  it("writes streaming input and closes only after fragmented completion events", async () => {
    const child = Object.assign(new EventEmitter(), {stdin:new PassThrough(),stdout:new PassThrough()}) as unknown as ChildProcessWithoutNullStreams;
    let input="";child.stdin.on("data", c => {input+=c;});
    attachClaudeInput(child,"render it");
    expect(JSON.parse(input).message.content).toBe("render it");
    child.stdout.emit("data",Buffer.from(JSON.stringify(started("a"))+"\n"+JSON.stringify(started("b"))+"\n"+JSON.stringify(result)+"\n"));
    await new Promise(setImmediate);expect(child.stdin.writableEnded).toBe(false);
    child.stdout.emit("data",Buffer.from(JSON.stringify(done("a"))+"\n"+JSON.stringify(result)+"\n"));
    await new Promise(setImmediate);expect(child.stdin.writableEnded).toBe(false);
    const terminal=JSON.stringify(done("b"))+"\n"+JSON.stringify(result)+"\n";
    child.stdout.emit("data",Buffer.from(terminal.slice(0,31)));
    child.stdout.emit("data",Buffer.from(terminal.slice(31)));
    await new Promise(setImmediate);expect(child.stdin.writableEnded).toBe(true);
    child.emit("close");
  });

});
