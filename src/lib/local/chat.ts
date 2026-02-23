import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { parseNDJSONChunk } from "@/lib/ndjson-parser";
import { transformCliError } from "@/lib/cli-error";
import { DEFAULT_MODEL } from "@/lib/models";
import {
  ensureLocalSessionLayout,
  getLocalSandboxId,
  localFileToApiUrl,
  resolveSessionFilePath,
} from "@/lib/local/config";
import {
  createLocalSession,
  createLocalRun,
  getLocalSession,
  insertLocalActivityEvent,
  insertLocalMessage,
  updateLocalRun,
  updateLocalSession,
} from "@/lib/local/db";
import {
  getActiveLocalRunBySandboxId,
  registerLocalRunProcess,
  spawnLocalClaudeProcess,
} from "@/lib/local/runtime";
import {
  clearLocalVoiceoverArtifacts,
  startLocalVoiceoverJob,
} from "@/lib/local/voiceover";
import { readLocalProjectSubtitles } from "@/lib/local/subtitles";
import { clearLocalHqArtifacts } from "@/lib/local/hq-render";
import {
  DEFAULT_ASPECT_RATIO,
  isAspectRatio,
} from "@/lib/aspect-ratio";

type LocalChatRequest = {
  prompt: string;
  session_id?: string;
  model?: string;
  aspect_ratio?: string;
  claude_session_id?: string;
  images?: Array<{ id: string; path: string; name: string; size: number; type: string }>;
};

type LocalSSEEvent = {
  type: "progress" | "complete" | "error" | "tool_use" | "tool_result" | "assistant_text" | "system_init";
  state?: "planning" | "coding" | "rendering" | "complete" | "error";
  message: string;
  sandbox_id?: string;
  claude_session_id?: string;
  run_id?: string;
  video_url?: string;
  progress?: number;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
  is_error?: boolean;
  model?: string;
  tools?: string[];
};

type ExecutionState = "planning" | "coding" | "rendering";

function inferStateFromTool(toolName: string, toolInput?: Record<string, unknown>): ExecutionState {
  if (toolName === "Bash") {
    const command = typeof toolInput?.command === "string" ? toolInput.command : "";
    if (command.includes("manim") || command.includes("ffmpeg") || command.includes("render")) {
      return "rendering";
    }
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "Read" || toolName === "Glob" || toolName === "Grep" || toolName === "Bash") {
    return "coding";
  }
  return "planning";
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Detect the output video in the project dir.
 * CLAUDE.md instructs Claude to output `video.mp4`, but the manim-skill plugin
 * may output `final.mp4` instead. Returns the most recently modified file
 * so a new `final.mp4` isn't masked by a stale `video.mp4`.
 */
const VIDEO_CANDIDATES = ["video.mp4", "final.mp4"] as const;
async function detectVideoFile(projectDir: string): Promise<{ path: string; stats: fs.Stats } | null> {
  let best: { path: string; stats: fs.Stats } | null = null;
  for (const name of VIDEO_CANDIDATES) {
    const filePath = path.join(projectDir, name);
    try {
      const stats = await fsp.stat(filePath);
      if (stats.isFile() && (!best || stats.mtimeMs > best.stats.mtimeMs)) {
        best = { path: filePath, stats };
      }
    } catch {
      // Not found, try next.
    }
  }
  return best;
}


function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

function buildPrompt(input: {
  projectDir: string;
  prompt: string;
  aspectRatio: string;
  imagePaths: string[];
}): string {
  const imageSection = input.imagePaths.length
    ? `\n\nAttached images:\n${input.imagePaths.map((p) => `- ${p}`).join("\n")}`
    : "";
  return `**Project Directory**: \`${input.projectDir}\` (cwd is already set)\n\n**Aspect Ratio**: ${input.aspectRatio}\n\n${input.prompt}${imageSection}`;
}

export async function handleLocalChatRequest(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  let clientAborted = false;
  request.signal.addEventListener("abort", async () => {
    clientAborted = true;
    try {
      await writer.close();
    } catch {
      // Already closed.
    }
  });

  const sendEvent = async (event: LocalSSEEvent) => {
    if (clientAborted) return;
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      clientAborted = true;
    }
  };

  (async () => {
    let runId: string | null = null;
    let sessionId: string | null = null;
    let sandboxId: string | null = null;
    let claudeSessionId = "";
    let modelForRun = "claude";
    let currentTurnId: string | null = null;

    const persistActivity = async (
      type: string,
      message: string,
      payload?: Record<string, unknown>
    ) => {
      if (!sessionId) return;
      insertLocalActivityEvent({
        session_id: sessionId,
        run_id: runId,
        turn_id: currentTurnId,
        type,
        message,
        payload: payload ?? null,
      });
    };

    try {
      const body = (await request.json()) as Partial<LocalChatRequest>;

      if (!body.session_id || typeof body.session_id !== "string") {
        await sendEvent({
          type: "error",
          state: "error",
          message: "session_id is required in local mode",
        });
        return;
      }
      sessionId = body.session_id;

      const promptStr = typeof body.prompt === "string" ? body.prompt : "";
      const rawPrompt = promptStr.trim();
      const hasImages = Array.isArray(body.images) && body.images.length > 0;
      if (!rawPrompt && !hasImages) {
        await sendEvent({
          type: "error",
          state: "error",
          message: "prompt or images required",
        });
        return;
      }

      let session = getLocalSession(sessionId);
      if (!session) {
        // Local single-user mode: allow chat to materialize a session lazily.
        session = createLocalSession({
          id: sessionId,
          model: DEFAULT_MODEL,
          aspect_ratio: isAspectRatio(body.aspect_ratio) ? body.aspect_ratio : null,
          voice_id: null,
        });
      }

      modelForRun = typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : session.model || "claude";

      sandboxId = session.sandbox_id || getLocalSandboxId(sessionId);
      const { projectDir } = ensureLocalSessionLayout(sessionId);

      if (rawPrompt) {
        if (session.title === "Untitled Animation") {
          const truncated = rawPrompt.length > 50 ? `${rawPrompt.slice(0, 50)}...` : rawPrompt;
          updateLocalSession(sessionId, { title: truncated });
        }
      }

      const userMessageId = insertLocalMessage({
        session_id: sessionId,
        role: "user",
        content: rawPrompt,
        metadata: hasImages ? { images: body.images } : null,
      });
      currentTurnId = userMessageId;

      const run = createLocalRun({
        session_id: sessionId,
        user_message_id: userMessageId,
        sandbox_id: sandboxId,
        claude_session_id: session.claude_session_id,
      });
      runId = run.id;

      await sendEvent({
        type: "system_init",
        message: "Local runtime initialized",
        model: modelForRun,
        tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
        sandbox_id: sandboxId,
        claude_session_id: session.claude_session_id || undefined,
      });
      await persistActivity("system_init", "Local runtime initialized", {
        model: modelForRun,
      });

      const inputPaths: string[] = [];
      if (Array.isArray(body.images) && body.images.length > 0) {
        const inputDir = path.join(projectDir, "inputs");
        await fsp.mkdir(inputDir, { recursive: true });

        for (const image of body.images) {
          if (!image || typeof image.path !== "string" || typeof image.name !== "string") continue;
          const resolved = resolveSessionFilePath(sessionId, image.path);
          if (!resolved) continue;
          const base = path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, "_");
          const dest = path.join(inputDir, base);
          try {
            await fsp.copyFile(resolved, dest);
            inputPaths.push(dest);
          } catch {
            // Ignore bad image copies and continue run.
          }
        }
      }

      const aspectRatio = isAspectRatio(body.aspect_ratio)
        ? body.aspect_ratio
        : isAspectRatio(session.aspect_ratio)
          ? session.aspect_ratio
          : DEFAULT_ASPECT_RATIO;
      const prompt = buildPrompt({
        projectDir,
        prompt: rawPrompt,
        aspectRatio,
        imagePaths: inputPaths,
      });

      const preRunVideo = await detectVideoFile(projectDir);

      const process = spawnLocalClaudeProcess({
        cwd: projectDir,
        prompt,
        model: modelForRun,
        resumeSessionId: session.claude_session_id || body.claude_session_id || null,
      });

      registerLocalRunProcess({
        sessionId,
        sandboxId,
        runId,
        process,
      });
      const trackedRun = getActiveLocalRunBySandboxId(sandboxId);

      const now = new Date().toISOString();
      updateLocalRun(runId, {
        status: "running",
        started_at: now,
        last_event_at: now,
        sandbox_id: sandboxId,
        claude_session_id: session.claude_session_id || null,
      });

      let state: ExecutionState = "planning";
      await sendEvent({
        type: "progress",
        state,
        message: "Running Claude locally...",
        sandbox_id: sandboxId,
        run_id: runId,
      });
      await persistActivity("progress", "Running Claude locally...");

      let ndjsonBuffer = "";
      let fullStderr = "";
      let finalAssistantText = "";

      let streamChain = Promise.resolve();
      const enqueue = (task: () => Promise<void>) => {
        streamChain = streamChain.then(task).catch((error) => {
          console.error("[Local Chat] Stream task failed:", error);
        });
      };

      process.stdout.on("data", (chunk: Buffer) => {
        const data = chunk.toString("utf8");
        enqueue(async () => {
          const parsed = parseNDJSONChunk(ndjsonBuffer, data);
          ndjsonBuffer = parsed.remainder;

          for (const obj of parsed.lines as Array<Record<string, unknown>>) {
            if (typeof obj.session_id === "string") {
              claudeSessionId = obj.session_id;
            }

            if (obj.type === "result" && typeof obj.result === "string") {
              finalAssistantText = obj.result;
            }

            if (obj.type !== "assistant" || !obj.message || typeof obj.message !== "object") {
              continue;
            }

            const message = obj.message as Record<string, unknown>;
            const blocks = Array.isArray(message.content)
              ? message.content as Array<Record<string, unknown>>
              : [];

            for (const block of blocks) {
              if (block.type === "text" && typeof block.text === "string") {
                await sendEvent({
                  type: "assistant_text",
                  message: block.text,
                  sandbox_id: sandboxId || undefined,
                  claude_session_id: claudeSessionId || undefined,
                });
                await persistActivity("assistant_text", block.text);
              }

              if (block.type === "tool_use") {
                const toolName = typeof block.name === "string" ? block.name : "Tool";
                const toolInput = (block.input && typeof block.input === "object")
                  ? block.input as Record<string, unknown>
                  : {};

                const nextState = inferStateFromTool(toolName, toolInput);
                if (nextState !== state) {
                  state = nextState;
                  const stateMessage = state === "rendering"
                    ? "Rendering video..."
                    : state === "coding"
                      ? "Writing code..."
                      : "Planning...";
                  await sendEvent({
                    type: "progress",
                    state,
                    message: stateMessage,
                    sandbox_id: sandboxId || undefined,
                    claude_session_id: claudeSessionId || undefined,
                  });
                  await persistActivity("progress", stateMessage);
                }

                await sendEvent({
                  type: "tool_use",
                  message: `${toolName}`,
                  tool_name: toolName,
                  tool_input: toolInput,
                  sandbox_id: sandboxId || undefined,
                  claude_session_id: claudeSessionId || undefined,
                });
                await persistActivity("tool_use", toolName, {
                  tool_name: toolName,
                  tool_input: toolInput,
                });
              }

              if (block.type === "tool_result") {
                const result = stringifyToolResult((block as { content?: unknown }).content);
                await sendEvent({
                  type: "tool_result",
                  message: "Tool result",
                  tool_result: result.slice(0, 1200),
                  is_error: Boolean((block as { is_error?: unknown }).is_error),
                  sandbox_id: sandboxId || undefined,
                  claude_session_id: claudeSessionId || undefined,
                });
                await persistActivity("tool_result", "Tool result", {
                  tool_result: result.slice(0, 1200),
                  is_error: Boolean((block as { is_error?: unknown }).is_error),
                });
              }
            }
          }
        });
      });

      process.stderr.on("data", (chunk: Buffer) => {
        const data = chunk.toString("utf8");
        enqueue(async () => {
          fullStderr += data;
          const match = data.match(/(\d+)%\|/);
          if (match) {
            const progress = Number.parseInt(match[1], 10);
            state = "rendering";
            await sendEvent({
              type: "progress",
              state: "rendering",
              message: `Rendering video... ${progress}%`,
              progress,
              sandbox_id: sandboxId || undefined,
              claude_session_id: claudeSessionId || undefined,
            });
            await persistActivity("progress", `Rendering video... ${progress}%`, {
              progress,
            });
          }
        });
      });

      const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        process.once("error", reject);
        process.once("exit", (code, signal) => resolve({ code, signal }));
      });

      await streamChain;

      if (ndjsonBuffer.trim()) {
        try {
          const trailing = JSON.parse(ndjsonBuffer.trim()) as Record<string, unknown>;
          if (typeof trailing.session_id === "string") {
            claudeSessionId = trailing.session_id;
          }
          if (trailing.type === "result" && typeof trailing.result === "string") {
            finalAssistantText = trailing.result;
          }
        } catch {
          // Ignore invalid trailing output.
        }
      }

      const wasCanceled =
        Boolean(trackedRun?.canceled) ||
        exitResult.signal === "SIGTERM" ||
        exitResult.signal === "SIGKILL" ||
        exitResult.code === -1;

      const planContent = await readTextFileIfExists(path.join(projectDir, "plan.md"));
      const scriptContent = await readTextFileIfExists(path.join(projectDir, "script.py"));
      const subtitlesContent = await readLocalProjectSubtitles(projectDir);

      const postRunVideo = await detectVideoFile(projectDir);
      const videoChanged = Boolean(
        postRunVideo &&
        (!preRunVideo ||
          postRunVideo.stats.mtimeMs !== preRunVideo.stats.mtimeMs ||
          postRunVideo.stats.size !== preRunVideo.stats.size)
      );

      let videoUrl: string | null = null;
      if (videoChanged && postRunVideo) {
        videoUrl = localFileToApiUrl(sessionId, postRunVideo.path);
      }

      const finishedAt = new Date().toISOString();

      if (wasCanceled) {
        insertLocalMessage({
          session_id: sessionId,
          role: "assistant",
          content: "Stopped by user",
        });

        updateLocalRun(runId, {
          status: "canceled",
          finished_at: finishedAt,
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || session.claude_session_id,
          error_message: "Stopped by user",
        });
        updateLocalSession(sessionId, {
          status: "active",
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || session.claude_session_id,
          model: modelForRun,
          plan_content: planContent,
          script_content: scriptContent,
          subtitles_content: subtitlesContent,
        });
        await sendEvent({
          type: "complete",
          state: "complete",
          message: "Stopped by user",
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || undefined,
          run_id: runId,
        });
        await persistActivity("complete", "Stopped by user");
        return;
      }

      if (exitResult.code !== 0) {
        const message = transformCliError(exitResult.code ?? 1, "", fullStderr.trim());
        updateLocalRun(runId, {
          status: "failed",
          finished_at: finishedAt,
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || session.claude_session_id,
          error_message: message,
        });
        updateLocalSession(sessionId, {
          status: "active",
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || session.claude_session_id,
          model: modelForRun,
          plan_content: planContent,
          script_content: scriptContent,
          subtitles_content: subtitlesContent,
        });
        await sendEvent({
          type: "error",
          state: "error",
          message,
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || undefined,
        });
        await persistActivity("error", message);
        return;
      }

      const assistantContent = finalAssistantText || "Complete";
      insertLocalMessage({
        session_id: sessionId,
        role: "assistant",
        content: assistantContent,
        metadata: videoUrl ? { video_url: videoUrl } : null,
      });

      if (videoChanged) {
        await Promise.all([
          clearLocalVoiceoverArtifacts(sessionId),
          clearLocalHqArtifacts(sessionId),
        ]);
      }

      updateLocalSession(sessionId, {
        status: "active",
        sandbox_id: sandboxId,
        claude_session_id: claudeSessionId || session.claude_session_id,
        model: modelForRun,
        plan_content: planContent,
        script_content: scriptContent,
        subtitles_content: subtitlesContent,
        video_path: videoChanged && postRunVideo ? postRunVideo.path : session.video_path,
        last_video_url: videoUrl || session.last_video_url,
        voiceover_status: videoChanged ? null : session.voiceover_status,
        voiceover_error: videoChanged ? null : session.voiceover_error,
        voiceover_audio_path: videoChanged ? null : session.voiceover_audio_path,
        hq_render_status: videoChanged ? null : session.hq_render_status,
        hq_render_progress: videoChanged ? null : session.hq_render_progress,
      });

      updateLocalRun(runId, {
        status: "completed",
        finished_at: finishedAt,
        sandbox_id: sandboxId,
        claude_session_id: claudeSessionId || session.claude_session_id,
        video_url: videoUrl,
      });

      if (videoChanged) {
        await startLocalVoiceoverJob(sessionId, {
          force: true,
          silentIfUnavailable: true,
        });
      }

      await sendEvent({
        type: "complete",
        state: "complete",
        message: "Complete",
        sandbox_id: sandboxId,
        claude_session_id: claudeSessionId || undefined,
        run_id: runId,
        video_url: videoUrl || undefined,
      });
      await persistActivity("complete", "Complete", videoUrl ? { video_url: videoUrl } : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected local-mode error occurred";
      if (runId) {
        updateLocalRun(runId, {
          status: "failed",
          finished_at: new Date().toISOString(),
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || null,
          error_message: message,
        });
      }
      if (sessionId) {
        updateLocalSession(sessionId, {
          status: "active",
          sandbox_id: sandboxId,
          claude_session_id: claudeSessionId || null,
          model: modelForRun,
        });
      }
      await sendEvent({
        type: "error",
        state: "error",
        message,
        sandbox_id: sandboxId || undefined,
        claude_session_id: claudeSessionId || undefined,
      });
      if (sessionId) {
        insertLocalActivityEvent({
          session_id: sessionId,
          run_id: runId,
          type: "error",
          message,
        });
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed.
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
