/**
 * Local Session Messages API
 *
 * GET /api/sessions/[sessionId]/messages
 */

import fsp from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/models";
import {
  ensureLocalSessionLayout,
  localFileToApiUrl,
} from "@/lib/local/config";
import { isSessionFeedbackMetadata } from "@/lib/local/feedback";
import {
  createLocalSession,
  getLocalActiveRun,
  getLocalSession,
  listLocalMessages,
  listLocalRuns,
  readLocalSessionArtifacts,
  updateLocalRun,
} from "@/lib/local/session-store";
import { readSessionTrajectory } from "@/lib/local/trajectory";
import {
  getActiveLocalRunBySessionId,
  killOrphanedAgentProcessGroup,
} from "@/lib/local/runtime";
import { copyAgentTranscript } from "@/lib/local/transcripts";

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

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const RUN_STALE_MS = 2 * 60 * 1000;

function isOlderThan(timestamp: string | null | undefined, thresholdMs: number): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > thresholdMs;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<Response> {
  const { sessionId } = await params;
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
