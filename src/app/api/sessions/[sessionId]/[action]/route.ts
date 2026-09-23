/**
 * Per-session actions — one route for all session sub-resources:
 *
 * GET  /api/sessions/[sessionId]/messages  chat history + active run + artifacts
 * POST /api/sessions/[sessionId]/feedback  record library feedback as a session message
 * POST /api/sessions/[sessionId]/handoff   new session seeded with this session's artifacts
 */

import fsp from "node:fs/promises";
import { shareSession, ShareError } from "@/lib/local/session-share";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import {
  ensureLocalSessionLayout,
  localFileToApiUrl,
} from "@/lib/local/config";
import {
  buildSessionFeedbackMessageContent,
  isSessionFeedbackMetadata,
  MAX_SESSION_FEEDBACK_LENGTH,
  normalizeSessionFeedbackContent,
  SESSION_FEEDBACK_MESSAGE_KIND,
  SESSION_FEEDBACK_SOURCE_LIBRARY,
} from "@/lib/local/feedback";
import { createHandoffFromLocalSession } from "@/lib/local/handoff";
import {
  createLocalSession,
  getLocalActiveRun,
  getLocalSession,
  insertLocalMessage,
  listLocalMessages,
  listLocalRuns,
  readLocalSessionArtifacts,
  updateLocalRun,
} from "@/lib/local/session-store";
import { copyAgentTranscript, readSessionDisplayTrajectory } from "@/lib/local/trajectory";
import {
  getActiveLocalRunBySessionId,
  killOrphanedAgentProcessGroup,
} from "@/lib/local/runtime";
import { isValidVoiceId } from "@/lib/voices";

interface RouteContext {
  params: Promise<{ sessionId: string; action: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sessionId, action } = await context.params;
  if (action !== "messages") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return getMessages(request, sessionId);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sessionId, action } = await context.params;

  switch (action) {
    case "share":
      try { return NextResponse.json(await shareSession(sessionId)); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sharing failed" }, { status: error instanceof ShareError ? error.status : 500 }); }
    case "feedback":
      return submitFeedback(request, sessionId);
    case "handoff":
      return createHandoff(request, sessionId);
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// GET messages
// ---------------------------------------------------------------------------

type MessageMetadata = {
  images?: Array<{
    id?: string;
    path: string;
    name?: string;
    size?: number;
    type?: string;
    url?: string;
  }>;
  video_url?: string;
};

const RUN_STALE_MS = 2 * 60 * 1000;

function isOlderThan(timestamp: string | null | undefined, thresholdMs: number): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > thresholdMs;
}

async function getMessages(request: NextRequest, sessionId: string): Promise<Response> {
  const includeTrajectory =
    request.nextUrl.searchParams.get("include_trajectory") === "1";

  // Local single-user mode: a URL can reference a session before it is persisted.
  // Materialize it on first read to avoid stale "Session not found" loops.
  let session = getLocalSession(sessionId);
  if (!session) {
    session = createLocalSession({
      id: sessionId,
      model: DEFAULT_MODEL,
      aspect_ratio: null,
      voice_id: null,
    });
    ensureLocalSessionLayout(session.id, { model: session.model });
  }

  const storedMessages = listLocalMessages(sessionId);
  const messages = storedMessages
    .filter((message) => !isSessionFeedbackMetadata(message.metadata))
    .map((message) => {
      const storedMetadata = (message.metadata || null) as MessageMetadata | null;
      const metadata: MessageMetadata = {};
      if (storedMetadata?.images && Array.isArray(storedMetadata.images)) {
        metadata.images = storedMetadata.images.map((img) => ({
          ...img,
          url: localFileToApiUrl(sessionId, img.path),
        }));
      }
      if (typeof storedMetadata?.video_url === "string") {
        metadata.video_url = storedMetadata.video_url;
      }
      return {
        ...message,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      };
    });

  let activeRun = getLocalActiveRun(sessionId);
  if (activeRun) {
    const hasLiveProcess = Boolean(getActiveLocalRunBySessionId(sessionId));
    const staleRunRef = activeRun.last_event_at || activeRun.started_at || activeRun.created_at;
    if (!hasLiveProcess && isOlderThan(staleRunRef, RUN_STALE_MS)) {
      // A stale run can leave a detached agent process behind (e.g. after a
      // server restart). Kill it so it doesn't keep working in the background.
      if (activeRun.pid) {
        killOrphanedAgentProcessGroup(activeRun.pid);
      }
      // The chat handler that would normally archive the CLI transcript died
      // with the server; preserve the trace here before closing the run out.
      if (activeRun.agent_session_id) {
        const { projectDir } = ensureLocalSessionLayout(sessionId);
        await copyAgentTranscript({
          sessionId,
          runId: activeRun.id,
          model: session.model,
          cwd: projectDir,
          agentSessionId: activeRun.agent_session_id,
        });
      }
      updateLocalRun(sessionId, activeRun.id, {
        status: "canceled",
        finished_at: new Date().toISOString(),
        error_message: "Run was interrupted before completion",
      });
      activeRun = null;
    }
  }

  let videoUrl = session.last_video_url;
  if (!videoUrl && session.video_path) {
    const stat = await fsp.stat(session.video_path).catch(() => null);
    const version = stat ? Math.round(stat.mtimeMs) : null;
    videoUrl = localFileToApiUrl(sessionId, session.video_path, version);
  }

  const artifacts = await readLocalSessionArtifacts(sessionId);

  return NextResponse.json({
    messages,
    // The original tab receives SSE. Refreshed tabs request transcript
    // activity on load and while reconnecting to an active run. Ordinary
    // polls omit this key so they cannot wipe the live SSE activity.
    ...(includeTrajectory
      ? {
          activityEvents: await readSessionDisplayTrajectory(
            sessionId,
            session.model,
            listLocalRuns(sessionId).map((run) => ({
              runId: run.id,
              turnId: run.user_message_id,
              createdAt: run.created_at,
              agentSessionId: run.agent_session_id,
              active: run.id === activeRun?.id,
              cliModel: storedMessages.find(message => message.id === run.user_message_id)?.metadata?.cli_model as string | undefined,
            }))
          ),
        }
      : {}),
    session: {
      agent_session_id: session.agent_session_id,
      last_video_url: videoUrl,
      plan_content: artifacts.plan_content,
      script_content: artifacts.script_content,
      subtitles_content: artifacts.subtitles_content,
      voice_id: session.voice_id,
      model: session.model,
      aspect_ratio: session.aspect_ratio,
    },
    activeRun,
  });
}

// ---------------------------------------------------------------------------
// POST feedback
// ---------------------------------------------------------------------------

async function submitFeedback(request: NextRequest, sessionId: string): Promise<Response> {
  const session = getLocalSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let feedbackText = "";
  try {
    const body = await request.json();
    feedbackText =
      typeof body?.feedback === "string" ? normalizeSessionFeedbackContent(body.feedback) : "";
  } catch {
    feedbackText = "";
  }

  if (!feedbackText) {
    return NextResponse.json(
      { error: "Feedback cannot be empty." },
      { status: 400 }
    );
  }

  if (feedbackText.length > MAX_SESSION_FEEDBACK_LENGTH) {
    return NextResponse.json(
      {
        error: `Feedback must be ${MAX_SESSION_FEEDBACK_LENGTH} characters or less.`,
      },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();
  const feedbackMetadata = {
    kind: SESSION_FEEDBACK_MESSAGE_KIND,
    source: SESSION_FEEDBACK_SOURCE_LIBRARY,
    feedback_text: feedbackText,
    session_id: session.id,
    session_number: session.session_number,
    session_title: session.title,
    submitted_at: submittedAt,
  };

  insertLocalMessage({
    session_id: session.id,
    role: "user",
    content: buildSessionFeedbackMessageContent(session.session_number, feedbackText),
    metadata: feedbackMetadata,
  });

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    session_number: session.session_number,
    submitted_at: submittedAt,
  });
}

// ---------------------------------------------------------------------------
// POST handoff
// ---------------------------------------------------------------------------

async function createHandoff(request: NextRequest, sessionId: string): Promise<Response> {
  const sourceSession = getLocalSession(sessionId);

  if (!sourceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    const requestedVoiceId = typeof body.voice_id === "string" ? body.voice_id.trim() : "";

    if (body.model !== undefined && (!requestedModel || !isRegisteredModelId(requestedModel))) {
      return NextResponse.json(
        { error: "Invalid model. Use one of: claude, codex" },
        { status: 400 },
      );
    }

    if (body.voice_id !== undefined && (!requestedVoiceId || !isValidVoiceId(requestedVoiceId))) {
      return NextResponse.json(
        { error: "Invalid voice_id" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await createHandoffFromLocalSession(sourceSession, {
        model: requestedModel || DEFAULT_MODEL,
        voiceId: requestedVoiceId || null,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create handoff";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
