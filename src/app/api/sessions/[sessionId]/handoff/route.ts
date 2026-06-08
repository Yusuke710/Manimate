/**
 * Local Session Handoff API
 *
 * POST /api/sessions/[sessionId]/handoff - Create a new session with the latest
 * plan.md, script.py, and rendered video from the source session.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getLocalSession,
} from "@/lib/local/db";
import { createHandoffFromLocalSession } from "@/lib/local/handoff";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { sessionId } = await context.params;
  const sourceSession = getLocalSession(sessionId);

  if (!sourceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    return NextResponse.json(await createHandoffFromLocalSession(sourceSession));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create handoff";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
