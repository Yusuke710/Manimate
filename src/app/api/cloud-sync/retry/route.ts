import { NextRequest, NextResponse } from "next/server";
import { queueLocalCloudSync } from "@/lib/local/cloud-sync";
import {
  getLocalSession,
  listLocalCloudSyncRetryCandidates,
} from "@/lib/local/db";

export async function POST(request: NextRequest): Promise<Response> {
  let sessionId: string | null = null;

  try {
    const body = await request.json().catch(() => null) as { session_id?: unknown } | null;
    sessionId = typeof body?.session_id === "string" && body.session_id.trim().length > 0
      ? body.session_id.trim()
      : null;
  } catch {
    sessionId = null;
  }

  const targets = sessionId
    ? (() => {
        const session = getLocalSession(sessionId);
        if (!session || !session.video_path || session.cloud_sync_status === "synced") {
          return [];
        }
        return [session];
      })()
    : listLocalCloudSyncRetryCandidates();

  for (const session of targets) {
    queueLocalCloudSync(session.id);
  }

  return NextResponse.json({
    queued_session_ids: targets.map((session) => session.id),
    count: targets.length,
  });
}
