import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { readStoredLocalConfig, updateStoredLocalConfig } from "./local-config-store";
import type { RenderConnection } from "../render-connection";

const execute = promisify(execFile);
let login: {process: ChildProcess; url?: string; error?: string} | undefined;

export function selectedRenderMode(): RenderConnection["mode"] {
  const value = process.env.MANIMATE_RENDER_MODE || readStoredLocalConfig().render_mode;
  return value === "local" || value === "cloud" ? value : null;
}

export async function renderConnection(): Promise<RenderConnection> {
  const mode = selectedRenderMode();
  if (mode !== "cloud") return {mode, status: mode === "local" ? "ready" : "disconnected"};
  if (login?.process.exitCode === null && !login.process.killed) return {mode, status: "pending", connect_url: login.url};
  if (login?.error) return {mode, status: "error", message: login.error};
  try {
    const {stdout} = await execute("manim-cloud", ["auth-status"], {timeout: 35000, maxBuffer: 16384});
    const data = JSON.parse(stdout);
    return {mode, status: data.status === "connected" ? "ready" : "disconnected", user_email: data.user_email};
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {mode, status: "error", message: missing ? "Install manim-cloud to enable cloud rendering." : "Cloud sign-in needs attention. Connect again."};
  }
}

export function selectRenderMode(mode: "cloud" | "local") {
  if (process.env.MANIMATE_RENDER_MODE && process.env.MANIMATE_RENDER_MODE !== mode) {
    throw new Error("Rendering is fixed by MANIMATE_RENDER_MODE. Remove that setting to change it here.");
  }
  if (mode === "local" && login) { login.process.kill(); login = undefined; }
  updateStoredLocalConfig(current => ({...current, render_mode: mode}));
}

export async function connectRenderer(): Promise<RenderConnection> {
  if (selectedRenderMode() !== "cloud") throw new Error("Choose cloud rendering first.");
  if (login?.process.exitCode === null && !login.process.killed) return renderConnection();
  const process = spawn("manim-cloud", ["login"], {stdio: ["ignore", "pipe", "pipe"]});
  const attempt = {process, url: undefined as string | undefined, error: undefined as string | undefined};
  login = attempt;
  let buffer = "";
  process.stdout?.on("data", chunk => {
    buffer += chunk.toString();
    const lines = buffer.split("\n"); buffer = lines.pop()!;
    for (const line of lines) {
      try { const data = JSON.parse(line); if (data.connect_url) attempt.url = data.connect_url; } catch {}
    }
  });
  process.stderr?.resume();
  process.on("error", () => { attempt.error = "Install manim-cloud before connecting."; });
  process.on("exit", code => { if (code !== 0) attempt.error = "Cloud sign-in did not finish. Try connecting again."; });
  return {mode: "cloud", status: "pending"};
}
