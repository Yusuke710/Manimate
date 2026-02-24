import type { ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  getHqResolution,
  isAspectRatio,
} from "@/lib/aspect-ratio";
import {
  ensureLocalSessionLayout,
  localFileToApiUrl,
} from "@/lib/local/config";
import { runLocalCommand } from "@/lib/local/command";
import {
  getLocalSession,
  updateLocalSession,
} from "@/lib/local/db";
import type { HqRenderProgress } from "@/lib/types";

const HQ_FRAME_RATE = 30;

interface StartLocalHqRenderResult {
  started: boolean;
  status: number;
  message: string;
  totalScenes?: number;
}

interface ActiveHqJob {
  sessionId: string;
  startedAt: string;
  controller: AbortController;
  currentProcess: ChildProcess | null;
  promise: Promise<void>;
}

const activeHqJobs = new Map<string, ActiveHqJob>();

function parseProgress(value: string | null): HqRenderProgress | null {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value) as HqRenderProgress;
  } catch {
    return null;
  }
}

function writeProgress(sessionId: string, progress: HqRenderProgress): void {
  updateLocalSession(sessionId, {
    hq_render_progress: JSON.stringify(progress),
  });
}

function extractSceneNames(script: string): string[] {
  const names: string[] = [];
  const regex = /^class\s+(\w+)\s*\([^)]*Scene[^)]*\)/gm;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(script)) !== null) {
    names.push(match[1]);
  }

  return names;
}

function rewriteScriptForHq(
  script: string,
  width: number,
  height: number,
  frameRate: number
): string {
  let result = script
    .replace(/^.*config\.pixel_height\s*=.*$/gm, "")
    .replace(/^.*config\.pixel_width\s*=.*$/gm, "")
    .replace(/^.*config\.frame_rate\s*=.*$/gm, "");

  const configLines = [
    `config.pixel_height = ${height}`,
    `config.pixel_width = ${width}`,
    `config.frame_rate = ${frameRate}`,
  ].join("\n");

  const importRegex = /^(?:from\s+.+\s+import\s+.+|import\s+.+)$/gm;
  let lastImportEnd = 0;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(result)) !== null) {
    lastImportEnd = importMatch.index + importMatch[0].length;
  }

  if (lastImportEnd > 0) {
    result =
      result.slice(0, lastImportEnd) +
      "\n\n" +
      configLines +
      "\n" +
      result.slice(lastImportEnd);
  } else {
    result = `${configLines}\n\n${result}`;
  }

  return result;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore missing files.
  }
}

async function findSceneVideoPath(
  projectDir: string,
  sceneName: string,
  height: number
): Promise<string | null> {
  const preferredPath = path.join(
    projectDir,
    "media",
    "videos",
    "script_hq",
    `${height}p${HQ_FRAME_RATE}`,
    `${sceneName}.mp4`
  );

  if (await fileExists(preferredPath)) {
    return preferredPath;
  }

  const fallback = await runLocalCommand({
    command: "bash",
    args: [
      "-lc",
      `find ${shellQuote(path.join(projectDir, "media", "videos"))} -name ${shellQuote(`${sceneName}.mp4`)} -type f | grep '/script_hq/' | head -1`,
    ],
    timeoutMs: 20_000,
  });

  if (fallback.exitCode !== 0 || !fallback.stdout.trim()) {
    return null;
  }

  return fallback.stdout.trim().split("\n")[0] || null;
}

function tail(input: string, max = 500): string {
  if (!input) return "";
  return input.length > max ? input.slice(-max) : input;
}

async function runHqRenderJob(job: ActiveHqJob): Promise<void> {
  const session = getLocalSession(job.sessionId);
  if (!session?.script_content) {
    updateLocalSession(job.sessionId, {
      hq_render_status: "failed",
      hq_render_progress: JSON.stringify({
        completed: 0,
        total: 0,
        current_scene: "",
        error: "No script found for this session",
      } satisfies HqRenderProgress),
    });
    return;
  }

  const { projectDir, artifactsDir } = ensureLocalSessionLayout(job.sessionId);
  const aspectRatio = isAspectRatio(session.aspect_ratio) ? session.aspect_ratio : "16:9";
  const { width, height } = getHqResolution(aspectRatio);
  const sceneNames = extractSceneNames(session.script_content);

  if (sceneNames.length === 0) {
    updateLocalSession(job.sessionId, {
      hq_render_status: "failed",
      hq_render_progress: JSON.stringify({
        completed: 0,
        total: 0,
        current_scene: "",
        error: "No Scene classes found in script",
      } satisfies HqRenderProgress),
    });
    return;
  }

  const hqScriptPath = path.join(projectDir, "script_hq.py");
  const concatPath = path.join(artifactsDir, "concat_hq.txt");
  const baseOutputPath = path.join(artifactsDir, "video_hq_base.mp4");
  const muxedOutputPath = path.join(artifactsDir, "video_hq_muxed.mp4");
  const finalOutputPath = path.join(artifactsDir, "video_hq.mp4");

  try {
    await fsp.mkdir(artifactsDir, { recursive: true });
    await fsp.writeFile(
      hqScriptPath,
      rewriteScriptForHq(session.script_content, width, height, HQ_FRAME_RATE),
      "utf8"
    );

    const sceneVideoPaths: string[] = [];
    for (let i = 0; i < sceneNames.length; i += 1) {
      if (job.controller.signal.aborted) {
        return;
      }

      const sceneName = sceneNames[i];
      writeProgress(job.sessionId, {
        completed: i,
        total: sceneNames.length,
        current_scene: sceneName,
      });

      const renderResult = await runLocalCommand({
        command: "manim",
        args: ["render", hqScriptPath, sceneName],
        cwd: projectDir,
        timeoutMs: 10 * 60 * 1000,
        signal: job.controller.signal,
        onSpawn: (process) => {
          job.currentProcess = process;
        },
      });
      job.currentProcess = null;

      if (renderResult.exitCode !== 0) {
        throw new Error(
          `Scene \"${sceneName}\" render failed: ${tail(renderResult.stderr) || `exit ${renderResult.exitCode}`}`
        );
      }

      const scenePath = await findSceneVideoPath(projectDir, sceneName, height);
      if (!scenePath) {
        throw new Error(`Scene \"${sceneName}\" rendered but output video was not found`);
      }
      sceneVideoPaths.push(scenePath);
    }

    if (job.controller.signal.aborted) {
      return;
    }

    if (sceneVideoPaths.length === 1) {
      await fsp.copyFile(sceneVideoPaths[0], baseOutputPath);
    } else {
      const concatList = sceneVideoPaths
        .map((filePath) => `file ${shellQuote(filePath)}`)
        .join("\n");
      await fsp.writeFile(concatPath, concatList, "utf8");

      const concatResult = await runLocalCommand({
        command: "ffmpeg",
        args: [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatPath,
          "-c",
          "copy",
          baseOutputPath,
        ],
        timeoutMs: 5 * 60 * 1000,
        signal: job.controller.signal,
        onSpawn: (process) => {
          job.currentProcess = process;
        },
      });
      job.currentProcess = null;

      if (concatResult.exitCode !== 0) {
        throw new Error(`FFmpeg concat failed: ${tail(concatResult.stderr)}`);
      }
    }

    const latestSession = getLocalSession(job.sessionId);
    const audioPath = latestSession?.voiceover_status === "completed"
      ? latestSession.voiceover_audio_path
      : null;

    if (audioPath && (await fileExists(audioPath))) {
      const mux = await runLocalCommand({
        command: "ffmpeg",
        args: [
          "-y",
          "-i",
          baseOutputPath,
          "-i",
          audioPath,
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          muxedOutputPath,
        ],
        timeoutMs: 3 * 60 * 1000,
        signal: job.controller.signal,
        onSpawn: (process) => {
          job.currentProcess = process;
        },
      });
      job.currentProcess = null;

      if (mux.exitCode === 0) {
        await fsp.copyFile(muxedOutputPath, finalOutputPath);
      } else {
        await fsp.copyFile(baseOutputPath, finalOutputPath);
      }
    } else {
      await fsp.copyFile(baseOutputPath, finalOutputPath);
    }

    if (job.controller.signal.aborted) {
      return;
    }

    updateLocalSession(job.sessionId, {
      hq_render_status: "completed",
      hq_render_progress: JSON.stringify({
        completed: sceneNames.length,
        total: sceneNames.length,
        current_scene: "",
        hq_video_url: localFileToApiUrl(
          job.sessionId,
          finalOutputPath,
          Math.round((await fsp.stat(finalOutputPath)).mtimeMs)
        ),
      } satisfies HqRenderProgress),
    });
  } catch (error) {
    if (job.controller.signal.aborted) {
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown HQ render error";
    updateLocalSession(job.sessionId, {
      hq_render_status: "failed",
      hq_render_progress: JSON.stringify({
        completed: 0,
        total: sceneNames.length,
        current_scene: "",
        error: message,
      } satisfies HqRenderProgress),
    });
  } finally {
    job.currentProcess = null;
    await safeUnlink(hqScriptPath);
    await safeUnlink(concatPath);
    await safeUnlink(baseOutputPath);
    await safeUnlink(muxedOutputPath);
  }
}

export async function startLocalHqRenderJob(
  sessionId: string
): Promise<StartLocalHqRenderResult> {
  const session = getLocalSession(sessionId);
  if (!session) {
    return {
      started: false,
      status: 404,
      message: "Session not found",
    };
  }

  if (!session.script_content?.trim()) {
    return {
      started: false,
      status: 400,
      message: "No script found for this session",
    };
  }

  if (activeHqJobs.has(sessionId)) {
    return {
      started: false,
      status: 409,
      message: "HQ render already in progress",
    };
  }

  const sceneNames = extractSceneNames(session.script_content);
  if (sceneNames.length === 0) {
    return {
      started: false,
      status: 400,
      message: "No Scene classes found in script",
    };
  }

  const previousProgress = parseProgress(session.hq_render_progress);
  updateLocalSession(sessionId, {
    hq_render_status: "rendering",
    hq_render_progress: JSON.stringify({
      completed: 0,
      total: sceneNames.length,
      current_scene: "",
      hq_video_url: previousProgress?.hq_video_url,
    } satisfies HqRenderProgress),
  });

  const controller = new AbortController();
  const job: ActiveHqJob = {
    sessionId,
    startedAt: new Date().toISOString(),
    controller,
    currentProcess: null,
    promise: Promise.resolve(),
  };

  job.promise = runHqRenderJob(job)
    .catch((error) => {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Unknown HQ render error";
      updateLocalSession(sessionId, {
        hq_render_status: "failed",
        hq_render_progress: JSON.stringify({
          completed: 0,
          total: sceneNames.length,
          current_scene: "",
          error: message,
        } satisfies HqRenderProgress),
      });
    })
    .finally(() => {
      activeHqJobs.delete(sessionId);
    });

  activeHqJobs.set(sessionId, job);
  void job.promise;

  return {
    started: true,
    status: 202,
    message: "HQ render started",
    totalScenes: sceneNames.length,
  };
}

export async function cancelLocalHqRenderJob(sessionId: string): Promise<boolean> {
  const active = activeHqJobs.get(sessionId);
  if (!active) {
    return false;
  }

  active.controller.abort();

  try {
    active.currentProcess?.kill("SIGTERM");
  } catch {
    // Process may already be gone.
  }

  setTimeout(() => {
    try {
      active.currentProcess?.kill("SIGKILL");
    } catch {
      // Ignore cleanup kill failures.
    }
  }, 500);

  return true;
}

export async function clearLocalHqArtifacts(sessionId: string): Promise<void> {
  const { artifactsDir } = ensureLocalSessionLayout(sessionId);
  await safeUnlink(path.join(artifactsDir, "video_hq.mp4"));
  await safeUnlink(path.join(artifactsDir, "video_hq_base.mp4"));
  await safeUnlink(path.join(artifactsDir, "video_hq_muxed.mp4"));
  await safeUnlink(path.join(artifactsDir, "concat_hq.txt"));
}
