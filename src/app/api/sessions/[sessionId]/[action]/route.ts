/**
 * Per-session actions — one route for all session sub-resources:
 *
 * GET  /api/sessions/[sessionId]/messages  chat history + active run + artifacts
 * POST /api/sessions/[sessionId]/share     create a hosted share link (waits for cloud sync)
 * POST /api/sessions/[sessionId]/feedback  record library feedback as a session message
 * POST /api/sessions/[sessionId]/handoff   new session seeded with this session's artifacts
 */

import fsp from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import {
  getLocalCloudSyncConfig,
  getLocalCloudSyncEnvOverride,
  queueLocalCloudSync,
} from "@/lib/local/cloud-sync";
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
  type LocalSession,
} from "@/lib/local/session-store";
import { copyAgentTranscript, readSessionTrajectory } from "@/lib/local/trajectory";
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
      return createShareLink(sessionId);
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

  const messages = listLocalMessages(sessionId)
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
    // Live tool activity streams over SSE. The archived trajectory (parsed
    // from <session>/transcripts/*.jsonl) is expensive-ish to build, so it is
    // only included when the client asks — the UI requests it once per
    // session load, not on every poll. The key is OMITTED otherwise: an
    // empty array would wipe the client's loaded trajectory on each poll.
    ...(includeTrajectory
      ? {
          activityEvents: readSessionTrajectory(
            sessionId,
            listLocalRuns(sessionId).map((run) => ({
              runId: run.id,
              turnId: run.user_message_id,
              createdAt: run.created_at,
            }))
          ),
        }
      : {}),
    session: {
      sandbox_id: session.sandbox_id,
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
// POST share
// ---------------------------------------------------------------------------

const CLOUD_SYNC_WAIT_TIMEOUT_MS = 12_000;
const CLOUD_SYNC_POLL_INTERVAL_MS = 600;
const CANONICAL_SHARE_PATH_RE = /^\/share\/[A-Za-z0-9_-]{16,200}$/;
const INVALID_SHARE_LINK_ERROR = "Hosted response did not return a canonical share link.";

type CloudShareSettings = {
  baseUrl: string;
  token: string;
};

type HostedShareLink = {
  token?: string;
  share_path: string;
  share_url: string;
};

class ShareRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ShareRouteError";
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCloudShareSettings(): CloudShareSettings | null {
  const config = getLocalCloudSyncEnvOverride() || getLocalCloudSyncConfig();
  if (config?.base_url && config.token) {
    return {
      baseUrl: config.base_url,
      token: config.token,
    };
  }

  return null;
}

function parseHostedShareLinkPayload(payload: unknown): HostedShareLink {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { share_path?: unknown }).share_path !== "string" ||
    typeof (payload as { share_url?: unknown }).share_url !== "string"
  ) {
    throw new ShareRouteError(INVALID_SHARE_LINK_ERROR, 502);
  }

  const sharePath = (payload as { share_path: string }).share_path;
  const shareUrl = (payload as { share_url: string }).share_url;

  if (!CANONICAL_SHARE_PATH_RE.test(sharePath)) {
    throw new ShareRouteError(INVALID_SHARE_LINK_ERROR, 502);
  }

  try {
    const parsedUrl = new URL(shareUrl);
    if (parsedUrl.pathname !== sharePath || !CANONICAL_SHARE_PATH_RE.test(parsedUrl.pathname)) {
      throw new Error("invalid-share-url");
    }
  } catch {
    throw new ShareRouteError(INVALID_SHARE_LINK_ERROR, 502);
  }

  return {
    token: typeof (payload as { token?: unknown }).token === "string"
      ? (payload as { token: string }).token
      : undefined,
    share_path: sharePath,
    share_url: shareUrl,
  };
}

async function createHostedShareLink(sessionId: string, settings: CloudShareSettings): Promise<HostedShareLink> {
  const response = await fetch(
    `${settings.baseUrl}/api/local-sync/sessions/${encodeURIComponent(sessionId)}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string"
      ? payload.error
      : "Failed to create share link";
    throw new ShareRouteError(message, response.status);
  }

  return parseHostedShareLinkPayload(payload);
}

async function waitForCloudMirrorSync(sessionId: string): Promise<LocalSession> {
  let session = getLocalSession(sessionId);
  if (!session) {
    throw new ShareRouteError("Session not found", 404);
  }

  if (session.cloud_sync_status === "synced") {
    return session;
  }

  if (!session.video_path) {
    throw new ShareRouteError(
      "This session is not ready to share yet. Finish a render first.",
      409,
    );
  }

  queueLocalCloudSync(sessionId);

  const deadline = Date.now() + CLOUD_SYNC_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CLOUD_SYNC_POLL_INTERVAL_MS);
    session = getLocalSession(sessionId);
    if (!session) {
      throw new ShareRouteError("Session not found", 404);
    }
    if (session.cloud_sync_status === "synced") {
      return session;
    }
    if (session.cloud_sync_status === "failed") {
      throw new ShareRouteError(
        session.cloud_last_error || "Cloud sync failed. Try again in a moment.",
        502,
      );
    }
  }

  session = getLocalSession(sessionId);
  throw new ShareRouteError(
    session?.cloud_last_error || "Still syncing to manimate.ai. Try again in a moment.",
    504,
  );
}

async function createShareLink(sessionId: string): Promise<Response> {
  const cloudSettings = getCloudShareSettings();

  if (!cloudSettings) {
    return NextResponse.json(
      { error: "Connect Manimate to manimate.ai before creating a share link." },
      { status: 409 },
    );
  }

  try {
    const syncedSession = await waitForCloudMirrorSync(sessionId);
    const hostedShare = await createHostedShareLink(sessionId, cloudSettings);

    return NextResponse.json({
      session_id: sessionId,
      token: hostedShare.token,
      share_path: hostedShare.share_path,
      share_url: hostedShare.share_url,
      cloud_sync_status: syncedSession.cloud_sync_status,
      cloud_last_synced_at: syncedSession.cloud_last_synced_at,
    });
  } catch (error) {
    if (error instanceof ShareRouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Failed to create share link." },
      { status: 500 },
    );
  }
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

  queueLocalCloudSync(session.id);

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
