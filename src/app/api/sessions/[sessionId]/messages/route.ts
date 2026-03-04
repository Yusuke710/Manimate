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
import {
  backfillLocalActivityTurnIds,
  createLocalSession,
  getLocalActiveRun,
  getLocalSession,
  listLocalActivityEvents,
  listLocalMessages,
  updateLocalRun,
} from "@/lib/local/db";
import { getActiveLocalRunBySessionId } from "@/lib/local/runtime";
import type { HqRenderProgress } from "@/lib/types";

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

function parseHqRenderProgress(raw: string | null): HqRenderProgress | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as HqRenderProgress;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<Response> {
  const { sessionId } = await params;

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
    ensureLocalSessionLayout(session.id);
  }

  const messages = listLocalMessages(sessionId).map((message) => {
    const metadata = (message.metadata || null) as MessageMetadata | null;
    if (metadata?.images && Array.isArray(metadata.images)) {
      metadata.images = metadata.images.map((img) => ({
        ...img,
        url: localFileToApiUrl(sessionId, img.path),
      }));
    }
    return {
      ...message,
      metadata,
    };
  });

  let activeRun = getLocalActiveRun(sessionId);
  if (activeRun) {
    const hasLiveProcess = Boolean(getActiveLocalRunBySessionId(sessionId));
    const staleRunRef = activeRun.last_event_at || activeRun.started_at || activeRun.created_at;
    if (!hasLiveProcess && isOlderThan(staleRunRef, RUN_STALE_MS)) {
      updateLocalRun(activeRun.id, {
        status: "canceled",
        finished_at: new Date().toISOString(),
        error_message: "Run was interrupted before completion",
      });
      activeRun = null;
    }
  }

  backfillLocalActivityTurnIds(sessionId);
  const activityEvents = listLocalActivityEvents(sessionId);

  let videoUrl = session.last_video_url;
  if (!videoUrl && session.video_path) {
    const stat = await fsp.stat(session.video_path).catch(() => null);
    const version = stat ? Math.round(stat.mtimeMs) : null;
    videoUrl = localFileToApiUrl(sessionId, session.video_path, version);
  }

  const hqRenderProgress = parseHqRenderProgress(session.hq_render_progress);

  return NextResponse.json({
    messages,
    activityEvents,
    session: {
      sandbox_id: session.sandbox_id,
      claude_session_id: session.claude_session_id,
      last_video_url: videoUrl,
      hq_render_status: session.hq_render_status,
      hq_render_progress: hqRenderProgress,
      plan_content: session.plan_content,
      script_content: session.script_content,
      subtitles_content: session.subtitles_content,
      voice_id: session.voice_id,
      model: session.model,
      aspect_ratio: session.aspect_ratio,
    },
    activeRun,
  });
}
