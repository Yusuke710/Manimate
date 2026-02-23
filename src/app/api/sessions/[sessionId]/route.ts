/**
 * Local Session API Route
 *
 * GET /api/sessions/[sessionId] - Get session details
 */

import { NextRequest, NextResponse } from "next/server";
import { getLocalSession } from "@/lib/local/db";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const { sessionId } = await context.params;
  const session = getLocalSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(session);
}
