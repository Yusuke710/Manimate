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
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import { isValidVoiceId } from "@/lib/voices";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { sessionId } = await context.params;
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
