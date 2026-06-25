import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseNDJSONChunk } from "@/lib/ndjson-parser";
import { normalizeLocalAgentCliSetupError, transformCliError } from "@/lib/cli-error";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import {
  ensureLocalSessionLayout,
  getLocalSandboxId,
  getLocalSessionPaths,
  localFileToApiUrl,
  resolveSessionFilePath,
} from "@/lib/local/config";
import { generateThumbnailAsync } from "@/lib/local/thumbnail";
import {
  createLocalSession,
  createLocalRun,
  getLocalSession,
  insertLocalActivityEvent,
  insertLocalMessage,
  listLocalMessages,
  updateLocalRun,
  updateLocalSession,
} from "@/lib/local/db";
import { queueLocalCloudSync } from "@/lib/local/cloud-sync";
import { isSessionFeedbackMetadata } from "@/lib/local/feedback";
import {
  beginLocalRunStart,
  endLocalRunStart,
  getActiveLocalRunBySandboxId,
  prewarmLocalKokoroVoice,
  registerLocalRunProcess,
  spawnLocalAgentProcess,
} from "@/lib/local/runtime";
import {
  readLocalProjectChapters,
  serializeLocalChapters,
} from "@/lib/local/chapters";
import { readLocalProjectSubtitles } from "@/lib/local/subtitles";
import {
  DEFAULT_ASPECT_RATIO,
  isAspectRatio,
} from "@/lib/aspect-ratio";
import { DEFAULT_VOICE_ID, NONE_VOICE_ID, isValidVoiceId } from "@/lib/voices";
import { buildConversationRecoveryContext } from "@/lib/conversation-recovery";
import type { TerminalStatus } from "@/lib/types";

type LocalChatRequest = {
  prompt: string;
  session_id?: string;
  model?: string;
  aspect_ratio?: string;
  voice_id?: string;
  agent_session_id?: string;
  images?: Array<{ id: string; path: string; name: string; size: number; type: string }>;
};

type LocalSSEEvent = {
  type: "progress" | "complete" | "error" | "tool_use" | "tool_result" | "assistant_text" | "system_init" | "artifact_update";
  state?: "planning" | "coding" | "rendering" | "complete" | "error";
  message: string;
  session_id?: string;
  sandbox_id?: string;
  agent_session_id?: string;
  run_id?: string;
  video_url?: string;
  plan_content?: string | null;
  script_content?: string | null;
  progress?: number;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
  is_error?: boolean;
  model?: string;
  tools?: string[];
  terminal_status?: TerminalStatus;
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

/** Extracts the first H1 title from plan.md content. Returns null if none found. */
function extractPlanTitle(planContent: string): string | null {
  const match = planContent.match(/^#\s+(.+)/m);
  if (!match) return null;
  return match[1].replace(/\s+#+\s*$/, "").trim();
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

const TOOL_RESULT_MAX_CHARS = 6000;
const TOOL_RESULT_MESSAGE_MAX_CHARS = 280;
const CLI_ERROR_OUTPUT_TAIL_MAX_CHARS = 64_000;

type RenderProfile = "iterate_480" | "hq_1080_30" | "uhd_4k_30";

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…(truncated)`;
}

function appendOutputTail(current: string, nextChunk: string, maxChars = CLI_ERROR_OUTPUT_TAIL_MAX_CHARS): string {
  if (!nextChunk) return current;
  const combined = `${current}${nextChunk}`;
  return combined.length <= maxChars ? combined : combined.slice(-maxChars);
}

function getMessageBlocks(obj: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!obj.message || typeof obj.message !== "object") return [];
  const message = obj.message as Record<string, unknown>;
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function getAgentSessionIdFromEvent(obj: Record<string, unknown>): string | null {
  for (const key of ["session_id", "thread_id", "conversation_id"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { input: value };
  } catch {
    return { input: value };
  }
}

function getCodexItem(obj: Record<string, unknown>): Record<string, unknown> | null {
  const item = obj.item;
  return item && typeof item === "object" && !Array.isArray(item)
    ? item as Record<string, unknown>
    : null;
}

function getCodexFileChanges(item: Record<string, unknown>): Array<{ path: string; kind: string }> {
  const changes = item.changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) return [];
    const record = change as Record<string, unknown>;
    const filePath = typeof record.path === "string" ? record.path : "";
    if (!filePath) return [];
    const kind = typeof record.kind === "string" ? record.kind : "change";
    return [{ path: filePath, kind }];
  });
}

function getCodexFileChangeToolName(changes: Array<{ path: string; kind: string }>): string {
  if (changes.length === 0) return "Edit";
  const kinds = new Set(changes.map((change) => change.kind));
  if (kinds.size === 1) {
    const [kind] = [...kinds];
    if (kind === "create") return "Write";
    if (kind === "delete") return "Delete";
  }
  return "Edit";
}

function formatCodexFileChangeMessage(
  changes: Array<{ path: string; kind: string }>,
  phase: "started" | "completed"
): string {
  if (changes.length === 0) {
    return phase === "started" ? "Editing files" : "Files updated";
  }
  if (changes.length === 1) {
    const [{ path: filePath, kind }] = changes;
    const action = kind === "create"
      ? phase === "started" ? "Writing" : "File created"
      : kind === "delete"
        ? phase === "started" ? "Deleting" : "File deleted"
        : phase === "started" ? "Editing" : "File updated";
    return `${action} ${filePath}`;
  }
  return phase === "started"
    ? `Editing ${changes.length} files`
    : `Updated ${changes.length} files`;
}

function invalidModelMessage(model: string): string {
  return `Invalid model "${model}". Use one of: claude, codex.`;
}

export function inferRenderProfile(prompt: string): RenderProfile {
  const normalized = prompt.toLowerCase();
  if (/\b(4k|2160p|uhd)\b/.test(normalized)) return "uhd_4k_30";
  if (/\b(1080p|1080|high quality|hq)\b/.test(normalized)) return "hq_1080_30";
  return "iterate_480";
}

export function buildPrompt(input: {
  projectDir: string;
  prompt: string;
  aspectRatio: string;
  voiceId: string;
  renderProfile: RenderProfile;
  images: Array<{ path: string; originalName: string }>;
}): string {
  const voiceLine = input.voiceId === NONE_VOICE_ID ? "" : `\n**Voice ID**: ${input.voiceId}`;
  const configSection = `\n\n**Aspect Ratio**: ${input.aspectRatio}${voiceLine}\n**Render Profile**: ${input.renderProfile}`;
  const imageSection = input.images.length
    ? `\n\nAttached files (use Read tool to inspect them as needed):\n${input.images.map((image) => `- ${image.path} (${image.originalName})`).join("\n")}`
    : "";
  return `**Project Directory**: \`${input.projectDir}\` (cwd is already set)${configSection}\n\n${input.prompt}${imageSection}`;
}

export async function handleLocalChatRequest(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  let clientAborted = false;
  let activeSessionId: string | null = null;
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
      const payload = activeSessionId && !event.session_id
        ? { ...event, session_id: activeSessionId }
        : event;
      await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    } catch {
      clientAborted = true;
    }
  };

  (async () => {
    let runId: string | null = null;
    let sessionId: string | null = null;
    let sandboxId: string | null = null;
    let agentSessionId = "";
    let modelForRun = DEFAULT_MODEL;
    let currentTurnId: string | null = null;
    let artifactSnapshotInterval: ReturnType<typeof setInterval> | null = null;

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
      activeSessionId = sessionId;

      const promptStr = typeof body.prompt === "string" ? body.prompt : "";
      const rawPrompt = promptStr.trim();
      const visibleRequestImages = Array.isArray(body.images) ? body.images : [];
      const hasVisibleImages = visibleRequestImages.length > 0;
      if (!rawPrompt && !hasVisibleImages) {
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

      const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
      if (body.model !== undefined && (!requestedModel || !isRegisteredModelId(requestedModel))) {
        await sendEvent({
          type: "error",
          state: "error",
          message: invalidModelMessage(requestedModel || String(body.model)),
        });
        return;
      }
      const requestedVoiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";
      if (body.voice_id !== undefined && (!requestedVoiceId || !isValidVoiceId(requestedVoiceId))) {
        await sendEvent({
          type: "error",
          state: "error",
          message: "Invalid voice_id",
        });
        return;
      }
      const requestedAspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio.trim() : "";
      if (body.aspect_ratio !== undefined && !isAspectRatio(requestedAspectRatio)) {
        await sendEvent({
          type: "error",
          state: "error",
          message: "Invalid aspect_ratio",
        });
        return;
      }

      const sessionModelIsValid = isRegisteredModelId(session.model);
      if (!sessionModelIsValid && !requestedModel) {
        await sendEvent({
          type: "error",
          state: "error",
          message: invalidModelMessage(session.model),
        });
        return;
      }

      modelForRun = requestedModel || session.model;
      const canReuseAgentSession = sessionModelIsValid && session.model === modelForRun;
      const voiceId = requestedVoiceId || session.voice_id || DEFAULT_VOICE_ID;
      const aspectRatio = isAspectRatio(requestedAspectRatio)
        ? requestedAspectRatio
        : isAspectRatio(session.aspect_ratio)
          ? session.aspect_ratio
          : DEFAULT_ASPECT_RATIO;
      const sessionUpdates: {
        model?: string;
        agent_session_id?: string | null;
        voice_id?: string | null;
        aspect_ratio?: string | null;
      } = {};
      if (session.model !== modelForRun) {
        sessionUpdates.model = modelForRun;
        sessionUpdates.agent_session_id = null;
      }
      if (requestedVoiceId && session.voice_id !== requestedVoiceId) {
        sessionUpdates.voice_id = requestedVoiceId;
      }
      if (requestedAspectRatio && session.aspect_ratio !== requestedAspectRatio) {
        sessionUpdates.aspect_ratio = requestedAspectRatio;
      }
      if (Object.keys(sessionUpdates).length > 0) {
        updateLocalSession(sessionId, sessionUpdates);
        session = getLocalSession(sessionId) || session;
      }
      const resumeSessionId = canReuseAgentSession
        ? session.agent_session_id || body.agent_session_id || null
        : null;
      agentSessionId = resumeSessionId || "";

      sandboxId = session.sandbox_id || getLocalSandboxId(sessionId);
      const { projectDir, sessionRoot } = ensureLocalSessionLayout(sessionId, {
        model: modelForRun,
      });

      // Prevent double-spawn: reject if a process is running OR we're mid-initialization.
      if (!beginLocalRunStart(sessionId)) {
        await sendEvent({
          type: "error",
          state: "error",
          message: "A run is already in progress for this session",
        });
        return;
      }

      if (rawPrompt) {
        if (session.title === "Untitled Animation") {
          const truncated = rawPrompt.length > 50 ? `${rawPrompt.slice(0, 50)}...` : rawPrompt;
          updateLocalSession(sessionId, { title: truncated });
        }
      }
      const conversationMessages = listLocalMessages(sessionId).filter(
        (message) => !isSessionFeedbackMetadata(message.metadata)
      );
      const userMessageMetadata: Record<string, unknown> = {};
      if (hasVisibleImages) userMessageMetadata.images = visibleRequestImages;

      const userMessageId = insertLocalMessage({
        session_id: sessionId,
        role: "user",
        content: rawPrompt,
        metadata: Object.keys(userMessageMetadata).length > 0 ? userMessageMetadata : null,
      });
      currentTurnId = userMessageId;

      const run = createLocalRun({
        session_id: sessionId,
        user_message_id: userMessageId,
        sandbox_id: sandboxId,
        agent_session_id: resumeSessionId,
      });
      runId = run.id;
      const didResume = Boolean(resumeSessionId);
      const initMessage = didResume ? "Manimate reconnected" : "Manimate initialized";

      await sendEvent({
        type: "system_init",
        message: initMessage,
        model: modelForRun,
        tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
        sandbox_id: sandboxId,
        agent_session_id: resumeSessionId || undefined,
      });
      await persistActivity("system_init", initMessage, {
        model: modelForRun,
      });

      const promptImages: Array<{ path: string; originalName: string }> = [];
      const requestedImageCount = visibleRequestImages.length;
      const seenRequestImagePaths = new Set<string>();
      for (const image of visibleRequestImages) {
        if (
          !image ||
          typeof image.path !== "string" ||
          typeof image.name !== "string"
        ) {
          continue;
        }
        const resolved = resolveSessionFilePath(sessionId, image.path);
        if (!resolved || seenRequestImagePaths.has(resolved)) continue;
        try {
          const stats = await fsp.stat(resolved);
          if (!stats.isFile()) continue;
          seenRequestImagePaths.add(resolved);
          promptImages.push({ path: resolved, originalName: image.name });
        } catch {
          // Ignore missing/inaccessible files and continue run.
        }
      }
      const preparedRequestImageCount = promptImages.length;

      let promptBody = rawPrompt;
      if (!resumeSessionId) {
        const recovered = buildConversationRecoveryContext({
          messages: conversationMessages,
          projectPath: projectDir,
          userId: "local-user",
          sessionId,
          excludeMessageId: userMessageId,
          allowedImagePathPrefixes: [`${path.resolve(sessionRoot)}${path.sep}`],
        });

        if (recovered.images.length > 0) {
          for (const image of recovered.images) {
            const resolved = resolveSessionFilePath(sessionId, image.path);
            if (!resolved) continue;
            try {
              await fsp.mkdir(path.dirname(image.sandboxPath), { recursive: true });
              await fsp.copyFile(resolved, image.sandboxPath);
              promptImages.push({ path: image.sandboxPath, originalName: image.name });
            } catch {
              // Ignore bad history-image copies and continue run.
            }
          }
        }

        if (recovered.historyPrompt) {
          const requestLine = rawPrompt
            ? rawPrompt
            : "[No text prompt in this turn. Use attached files if provided.]";
          promptBody = `${recovered.historyPrompt}\n\nCurrent user request:\n${requestLine}`;
        }
      }

      if (requestedImageCount > 0 && preparedRequestImageCount === 0) {
        throw new Error("Attached files could not be prepared for local agent access");
      }

      prewarmLocalKokoroVoice({ cwd: projectDir, voiceId });
      const prompt = buildPrompt({
        projectDir,
        prompt: promptBody,
        aspectRatio,
        voiceId,
        renderProfile: inferRenderProfile(rawPrompt),
        images: promptImages,
      });

      const preRunVideo = await detectVideoFile(projectDir);
      let streamedPlanContent: string | null = session.plan_content;
      let streamedScriptContent: string | null = session.script_content;

      const syncArtifactSnapshot = async () => {
        if (!sessionId) return;
        const [nextPlanContent, nextScriptContent] = await Promise.all([
          readTextFileIfExists(path.join(projectDir, "plan.md")),
          readTextFileIfExists(path.join(projectDir, "script.py")),
        ]);
        if (
          nextPlanContent === streamedPlanContent &&
          nextScriptContent === streamedScriptContent
        ) {
          return;
        }
        streamedPlanContent = nextPlanContent;
        streamedScriptContent = nextScriptContent;
        const midRunPlanTitle = nextPlanContent ? extractPlanTitle(nextPlanContent) : null;
        updateLocalSession(sessionId, {
          plan_content: nextPlanContent,
          script_content: nextScriptContent,
          ...(midRunPlanTitle ? { title: midRunPlanTitle } : {}),
        });
        await sendEvent({
          type: "artifact_update",
          message: "Artifacts updated",
          sandbox_id: sandboxId || undefined,
          agent_session_id: agentSessionId || undefined,
          plan_content: nextPlanContent,
          script_content: nextScriptContent,
        });
      };

      const process = spawnLocalAgentProcess({
        cwd: projectDir,
        prompt,
        model: modelForRun,
        resumeSessionId,
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
        agent_session_id: resumeSessionId,
      });

      let state: ExecutionState = "planning";
      await sendEvent({
        type: "progress",
        state,
        message: "Running Manimate...",
        sandbox_id: sandboxId,
        run_id: runId,
      });
      await persistActivity("progress", "Running Manimate...");

      let ndjsonBuffer = "";
      let rawStdoutTail = "";
      let stderrTail = "";
      let finalAssistantText = "";

      let streamChain = Promise.resolve();
      const enqueue = (task: () => Promise<void>) => {
        streamChain = streamChain.then(task).catch((error) => {
          console.error("[Local Chat] Stream task failed:", error);
        });
      };

      const emitProgressForTool = async (
        toolName: string,
        toolInput: Record<string, unknown>
      ) => {
        const nextState = inferStateFromTool(toolName, toolInput);
        if (nextState === state) return;
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
          agent_session_id: agentSessionId || undefined,
        });
        await persistActivity("progress", stateMessage);
      };

      const emitToolUse = async (
        toolName: string,
        message: string,
        toolInput: Record<string, unknown>
      ) => {
        await emitProgressForTool(toolName, toolInput);
        await sendEvent({
          type: "tool_use",
          message,
          tool_name: toolName,
          tool_input: toolInput,
          sandbox_id: sandboxId || undefined,
          agent_session_id: agentSessionId || undefined,
        });
        await persistActivity("tool_use", message, {
          tool_name: toolName,
          tool_input: toolInput,
        });
      };

      const emitToolResult = async (
        message: string,
        toolResult: string,
        isError: boolean
      ) => {
        await sendEvent({
          type: "tool_result",
          message,
          tool_result: toolResult,
          is_error: isError,
          sandbox_id: sandboxId || undefined,
          agent_session_id: agentSessionId || undefined,
        });
        await persistActivity("tool_result", message, {
          tool_result: toolResult,
          is_error: isError,
        });
      };

      artifactSnapshotInterval = setInterval(() => {
        enqueue(syncArtifactSnapshot);
      }, 2000);

      process.stdout.on("data", (chunk: Buffer) => {
        const data = chunk.toString("utf8");
        enqueue(async () => {
          rawStdoutTail = appendOutputTail(rawStdoutTail, data);
          const parsed = parseNDJSONChunk(ndjsonBuffer, data);
          ndjsonBuffer = parsed.remainder;

          for (const obj of parsed.lines as Array<Record<string, unknown>>) {
            const nextAgentSessionId = getAgentSessionIdFromEvent(obj);
            if (nextAgentSessionId) {
              agentSessionId = nextAgentSessionId;
            }

            if (obj.type === "result" && typeof obj.result === "string") {
              finalAssistantText = obj.result;
            }

            if (modelForRun === "codex") {
              const eventType = typeof obj.type === "string" ? obj.type : "";
              const item = getCodexItem(obj);
              const itemType = typeof item?.type === "string" ? item.type : "";

              if (
                eventType === "agent_message" &&
                typeof obj.message === "string"
              ) {
                finalAssistantText = obj.message;
                await sendEvent({
                  type: "assistant_text",
                  message: obj.message,
                  sandbox_id: sandboxId || undefined,
                  agent_session_id: agentSessionId || undefined,
                });
                await persistActivity("assistant_text", obj.message);
              }

              if (itemType === "agent_message" && typeof item?.text === "string") {
                finalAssistantText = item.text;
                await sendEvent({
                  type: "assistant_text",
                  message: item.text,
                  sandbox_id: sandboxId || undefined,
                  agent_session_id: agentSessionId || undefined,
                });
                await persistActivity("assistant_text", item.text);
              }

              if (itemType === "command_execution") {
                const command = typeof item?.command === "string" ? item.command : "";
                const toolInput = command ? { command } : {};
                const status = typeof item?.status === "string" ? item.status : "";
                const exitCode = typeof item?.exit_code === "number" ? item.exit_code : null;

                if (eventType === "item.started" || status === "in_progress") {
                  await emitToolUse("Bash", command || "Bash", toolInput);
                } else if (eventType === "item.completed" || status === "completed") {
                  const rawOutput = typeof item?.aggregated_output === "string"
                    ? item.aggregated_output.trim()
                    : "";
                  const rawResult = rawOutput || (
                    exitCode === null
                      ? "Command completed."
                      : `Command exited with code ${exitCode}.`
                  );
                  const toolResult = truncateText(rawResult, TOOL_RESULT_MAX_CHARS);
                  const message = truncateText(toolResult, TOOL_RESULT_MESSAGE_MAX_CHARS);
                  const isError = typeof exitCode === "number" && exitCode !== 0;
                  await emitToolResult(message, toolResult, isError);
                  await syncArtifactSnapshot();
                }
              }

              if (item && itemType === "file_change") {
                const changes = getCodexFileChanges(item);
                const toolName = getCodexFileChangeToolName(changes);
                const toolInput = { changes };
                const status = typeof item?.status === "string" ? item.status : "";

                if (eventType === "item.started" || status === "in_progress") {
                  const message = formatCodexFileChangeMessage(changes, "started");
                  await emitToolUse(toolName, message, toolInput);
                } else if (eventType === "item.completed" || status === "completed") {
                  const message = formatCodexFileChangeMessage(changes, "completed");
                  await emitToolResult(message, message, false);
                  await syncArtifactSnapshot();
                }
              }

              if (itemType === "function_call") {
                const toolName = typeof item?.name === "string" ? item.name : "Tool";
                const toolInput = parseToolInput(item?.arguments ?? item?.input);
                await emitToolUse(toolName, toolName, toolInput);
              }

              if (itemType === "function_call_output") {
                const rawResult = stringifyToolResult(item?.output).trim()
                  || "Tool completed with no text output.";
                const toolResult = truncateText(rawResult, TOOL_RESULT_MAX_CHARS);
                const message = truncateText(toolResult, TOOL_RESULT_MESSAGE_MAX_CHARS);
                await emitToolResult(message, toolResult, false);
                await syncArtifactSnapshot();
              }
            }

            const messageType = typeof obj.type === "string" ? obj.type : "";
            const blocks = getMessageBlocks(obj);
            if (blocks.length === 0) {
              continue;
            }

            for (const block of blocks) {
              if (messageType === "assistant" && block.type === "text" && typeof block.text === "string") {
                await sendEvent({
                  type: "assistant_text",
                  message: block.text,
                  sandbox_id: sandboxId || undefined,
                  agent_session_id: agentSessionId || undefined,
                });
                await persistActivity("assistant_text", block.text);
              }

              if (messageType === "assistant" && block.type === "tool_use") {
                const toolName = typeof block.name === "string" ? block.name : "Tool";
                const toolInput = (block.input && typeof block.input === "object")
                  ? block.input as Record<string, unknown>
                  : {};

                await emitToolUse(toolName, toolName, toolInput);
              }

              if (block.type === "tool_result") {
                const blockResult = stringifyToolResult((block as { content?: unknown }).content).trim();
                const topLevelResult = stringifyToolResult((obj as { tool_use_result?: unknown }).tool_use_result).trim();
                const rawResult = blockResult || topLevelResult || "Tool completed with no text output.";
                const toolResult = truncateText(rawResult, TOOL_RESULT_MAX_CHARS);
                const message = truncateText(toolResult, TOOL_RESULT_MESSAGE_MAX_CHARS);
                const isError = Boolean((block as { is_error?: unknown }).is_error);
                await emitToolResult(message, toolResult, isError);
                await syncArtifactSnapshot();
              }
            }
          }
        });
      });

      process.stderr.on("data", (chunk: Buffer) => {
        const data = chunk.toString("utf8");
        enqueue(async () => {
          stderrTail = appendOutputTail(stderrTail, data);
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
              agent_session_id: agentSessionId || undefined,
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

      if (artifactSnapshotInterval) {
        clearInterval(artifactSnapshotInterval);
        artifactSnapshotInterval = null;
      }
      await streamChain;

      if (ndjsonBuffer.trim()) {
        try {
          const trailing = JSON.parse(ndjsonBuffer.trim()) as Record<string, unknown>;
          const trailingAgentSessionId = getAgentSessionIdFromEvent(trailing);
          if (trailingAgentSessionId) {
            agentSessionId = trailingAgentSessionId;
          }
          if (trailing.type === "result" && typeof trailing.result === "string") {
            finalAssistantText = trailing.result;
          }
          const trailingItem = getCodexItem(trailing);
          if (
            modelForRun === "codex" &&
            trailingItem?.type === "agent_message" &&
            typeof trailingItem.text === "string"
          ) {
            finalAssistantText = trailingItem.text;
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
      const chapters = videoChanged ? await readLocalProjectChapters(projectDir) : [];
      const serializedChapters = serializeLocalChapters(chapters);

      let videoUrl: string | null = null;
      if (videoChanged && postRunVideo) {
        videoUrl = localFileToApiUrl(
          sessionId,
          postRunVideo.path,
          Math.round(postRunVideo.stats.mtimeMs)
        );
        // Generate thumbnail fire-and-forget — picks most-content frame via ffmpeg thumbnail filter
        const { sessionRoot } = getLocalSessionPaths(sessionId);
        generateThumbnailAsync(postRunVideo.path, sessionRoot);
      }

      const finishedAt = new Date().toISOString();

      if (wasCanceled) {
        updateLocalRun(runId, {
          status: "canceled",
          finished_at: finishedAt,
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || session.agent_session_id,
          error_message: "Stopped by user",
        });
        const canceledPlanTitle = planContent ? extractPlanTitle(planContent) : null;
        updateLocalSession(sessionId, {
          status: "active",
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || session.agent_session_id,
          model: modelForRun,
          ...(canceledPlanTitle ? { title: canceledPlanTitle } : {}),
          plan_content: planContent,
          script_content: scriptContent,
          subtitles_content: subtitlesContent,
          ...(videoChanged && postRunVideo
            ? {
                video_path: postRunVideo.path,
                last_video_url: videoUrl,
                chapters: serializedChapters,
              }
            : {}),
        });
        await sendEvent({
          type: "artifact_update",
          message: "Artifacts updated",
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || undefined,
          plan_content: planContent,
          script_content: scriptContent,
        });
        await sendEvent({
          type: "complete",
          state: "complete",
          message: "Stopped by user",
          terminal_status: "canceled",
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || undefined,
          run_id: runId,
          video_url: videoUrl || undefined,
        });
        await persistActivity("complete", "Stopped by user", {
          terminal_status: "canceled",
        });
        return;
      }

      if (exitResult.code !== 0) {
        const message = transformCliError(
          exitResult.code ?? 1,
          rawStdoutTail.trim(),
          stderrTail.trim(),
          modelForRun
        );
        updateLocalRun(runId, {
          status: "failed",
          finished_at: finishedAt,
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || session.agent_session_id,
          error_message: message,
        });
        const failedPlanTitle = planContent ? extractPlanTitle(planContent) : null;
        updateLocalSession(sessionId, {
          status: "active",
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || session.agent_session_id,
          model: modelForRun,
          ...(failedPlanTitle ? { title: failedPlanTitle } : {}),
          plan_content: planContent,
          script_content: scriptContent,
          subtitles_content: subtitlesContent,
        });
        await sendEvent({
          type: "artifact_update",
          message: "Artifacts updated",
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || undefined,
          plan_content: planContent,
          script_content: scriptContent,
        });
        await sendEvent({
          type: "error",
          state: "error",
          message,
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || undefined,
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

      const planTitle = planContent ? extractPlanTitle(planContent) : null;
      updateLocalSession(sessionId, {
        status: "active",
        sandbox_id: sandboxId,
        agent_session_id: agentSessionId || session.agent_session_id,
        model: modelForRun,
        ...(planTitle ? { title: planTitle } : {}),
        plan_content: planContent,
        script_content: scriptContent,
        subtitles_content: subtitlesContent,
        chapters: videoChanged ? serializedChapters : session.chapters,
        video_path: videoChanged && postRunVideo ? postRunVideo.path : session.video_path,
        last_video_url: videoUrl || session.last_video_url,
      });
      await sendEvent({
        type: "artifact_update",
        message: "Artifacts updated",
        sandbox_id: sandboxId,
        agent_session_id: agentSessionId || undefined,
        plan_content: planContent,
        script_content: scriptContent,
      });

      updateLocalRun(runId, {
        status: "completed",
        finished_at: finishedAt,
        sandbox_id: sandboxId,
        agent_session_id: agentSessionId || session.agent_session_id,
        video_url: videoUrl,
      });

      await sendEvent({
        type: "complete",
        state: "complete",
        message: "Complete",
        terminal_status: "completed",
        sandbox_id: sandboxId,
        agent_session_id: agentSessionId || undefined,
        run_id: runId,
        video_url: videoUrl || undefined,
      });
      await persistActivity("complete", "Complete", {
        ...(videoUrl ? { video_url: videoUrl } : {}),
        terminal_status: "completed",
      });
      queueLocalCloudSync(sessionId);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "An unexpected local-mode error occurred";
      const message = normalizeLocalAgentCliSetupError(modelForRun, rawMessage) || rawMessage;
      if (runId) {
        updateLocalRun(runId, {
          status: "failed",
          finished_at: new Date().toISOString(),
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || null,
          error_message: message,
        });
      }
      if (sessionId) {
        updateLocalSession(sessionId, {
          status: "active",
          sandbox_id: sandboxId,
          agent_session_id: agentSessionId || null,
          model: modelForRun,
        });
      }
      await sendEvent({
        type: "error",
        state: "error",
        message,
        sandbox_id: sandboxId || undefined,
        agent_session_id: agentSessionId || undefined,
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
      if (artifactSnapshotInterval) {
        clearInterval(artifactSnapshotInterval);
      }
      if (sessionId) endLocalRunStart(sessionId);
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
