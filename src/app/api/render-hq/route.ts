import { NextRequest, NextResponse } from "next/server";
import {
  cancelLocalHqRenderJob,
  startLocalHqRenderJob,
} from "@/lib/local/hq-render";
import {
  getLocalSession,
  updateLocalSession,
} from "@/lib/local/db";

interface RenderHqRequest {
  session_id?: string;
}

function getSessionId(body: RenderHqRequest): string | null {
  const sessionId = body.session_id?.trim();
  return sessionId || null;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: RenderHqRequest;
  try {
    body = (await request.json()) as RenderHqRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = getSessionId(body);
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const result = await startLocalHqRenderJob(sessionId);
  if (!result.started) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json(
    {
      success: true,
      message: result.message,
      total_scenes: result.totalScenes ?? 0,
    },
    { status: result.status }
  );
}

export async function DELETE(request: NextRequest): Promise<Response> {
  let body: RenderHqRequest;
  try {
    body = (await request.json()) as RenderHqRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = getSessionId(body);
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const session = getLocalSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await cancelLocalHqRenderJob(sessionId);
  updateLocalSession(sessionId, {
    hq_render_status: null,
    hq_render_progress: null,
  });

  return NextResponse.json({ success: true });
}
