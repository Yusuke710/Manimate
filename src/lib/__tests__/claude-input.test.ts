import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { attachClaudeInput, ClaudeInputLifecycle } from "@/lib/local/claude-input";

const result = { type: "result", subtype: "success", queued_turn_count: 0 };
const started = (id: string) => ({ type: "system", subtype: "task_started", task_id: id, is_backgrounded: true });
const done = (id: string, status = "completed") => ({ type: "system", subtype: "task_notification", task_id: id, status });

describe("Claude streaming input lifetime", () => {
  it("waits past an initial result until background completion is handled", () => {
    const s = new ClaudeInputLifecycle();
    s.observe(started("render")); s.observe(result);
    expect(s.shouldClose).toBe(false);
    s.observe({type:"system",subtype:"background_tasks_changed",tasks:[]});
    s.observe(result); expect(s.shouldClose).toBe(false);
    s.observe(done("render")); expect(s.shouldClose).toBe(false);
    s.observe({...result, origin:{kind:"task-notification"}});
    expect(s.shouldClose).toBe(true);
  });

  it("waits for multiple jobs and queued notification turns", () => {
    const s = new ClaudeInputLifecycle();
    s.observe(started("a")); s.observe(started("b")); s.observe(result);
    s.observe(done("a")); s.observe(result); expect(s.shouldClose).toBe(false);
    s.observe(done("b")); s.observe({...result,queued_turn_count:1}); expect(s.shouldClose).toBe(false);
    s.observe(result); expect(s.shouldClose).toBe(true);
  });

  it("handles notification consumption during a foreground tool wait", () => {
    const s = new ClaudeInputLifecycle();
    s.observe({type:"user",tool_use_result:{backgroundTaskId:"a"}});
    s.observe(done("a")); s.observe({type:"assistant"}); s.observe(result);
    expect(s.shouldClose).toBe(true);
    // Out-of-order task bookends must not resurrect completed work.
    s.observe(started("a")); expect(s.shouldClose).toBe(true);
  });

  it("lets Claude handle failed/stopped jobs and ignores nested results", () => {
    const s = new ClaudeInputLifecycle();
    s.observe(started("a")); s.observe({...result,parent_tool_use_id:"parent"});
    expect(s.shouldClose).toBe(false);
    s.observe(done("a","failed")); expect(s.shouldClose).toBe(false);
    s.observe(result); expect(s.shouldClose).toBe(true);
  });

  it("closes on terminal API errors even with pending tasks", () => {
    const s = new ClaudeInputLifecycle(); s.observe(started("a"));
    s.observe({type:"result",is_error:true,subtype:"error_during_execution"});
    expect(s.shouldClose).toBe(true);
  });

  it("writes streaming input and closes only after fragmented completion events", async () => {
    const child = Object.assign(new EventEmitter(), {stdin:new PassThrough(),stdout:new PassThrough()}) as unknown as ChildProcessWithoutNullStreams;
    let input="";child.stdin.on("data", c => {input+=c;});
    attachClaudeInput(child,"render it");
    expect(JSON.parse(input).message.content).toBe("render it");
    child.stdout.emit("data",Buffer.from(JSON.stringify(started("a"))+"\n"+JSON.stringify(result)+"\n"));
    await new Promise(setImmediate);expect(child.stdin.writableEnded).toBe(false);
    const terminal=JSON.stringify(done("a"))+"\n"+JSON.stringify(result)+"\n";
    child.stdout.emit("data",Buffer.from(terminal.slice(0,31)));
    child.stdout.emit("data",Buffer.from(terminal.slice(31)));
    await new Promise(setImmediate);expect(child.stdin.writableEnded).toBe(true);
    child.emit("close");
  });

  it("does not hang on metadata after a result", async () => {
    const child = Object.assign(new EventEmitter(), {stdin:new PassThrough(),stdout:new PassThrough()}) as unknown as ChildProcessWithoutNullStreams;
    attachClaudeInput(child,"hello");
    child.stdout.emit("data",Buffer.from(JSON.stringify(result)+"\n"+JSON.stringify({type:"rate_limit_event"})+"\n"));
    await new Promise(setImmediate);expect(child.stdin.writableEnded).toBe(true);child.emit("close");
  });
});
