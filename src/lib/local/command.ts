import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

export interface LocalCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunLocalCommandInput {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onSpawn?: (process: ChildProcess) => void;
}

export async function runLocalCommand(input: RunLocalCommandInput): Promise<LocalCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    input.onSpawn?.(child);

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (err: Error | null, result?: LocalCommandResult) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (input.signal) input.signal.removeEventListener("abort", onAbort);
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error("Command ended without result"));
      }
    };

    const killHard = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already exited.
      }
    };

    const requestStop = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process already exited.
      }
      setTimeout(killHard, 500);
    };

    const timeout = input.timeoutMs
      ? setTimeout(() => {
          requestStop();
          finish(
            new Error(
              `Command timed out after ${input.timeoutMs}ms: ${input.command} ${input.args.join(" ")}`
            )
          );
        }, input.timeoutMs)
      : undefined;

    const onAbort = () => {
      requestStop();
      finish(new Error(`Command aborted: ${input.command} ${input.args.join(" ")}`));
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener("abort", onAbort);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      finish(error);
    });

    child.on("close", (code) => {
      finish(null, {
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}
