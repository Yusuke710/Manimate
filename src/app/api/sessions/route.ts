/**
 * Local Sessions API Route
 *
 * GET  /api/sessions - List sessions
 * POST /api/sessions - Create session
 */

import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import { isAspectRatio, type AspectRatio } from "@/lib/aspect-ratio";
import {
  createLocalSession,
  getLocalSession,
  listLocalSessions,
} from "@/lib/local/db";
import { ensureLocalSessionLayout } from "@/lib/local/config";

export async function GET(): Promise<Response> {
  const sessions = listLocalSessions();
  return NextResponse.json(sessions);
}

export async function POST(request: NextRequest): Promise<Response> {
  let model = DEFAULT_MODEL;
  let clientId: string | undefined;
  let aspectRatio: AspectRatio | undefined;
  let voiceId: string | undefined;

  try {
    const body = await request.json();
    if (body.model && typeof body.model === "string" && isRegisteredModelId(body.model)) {
      model = body.model;
    }
    if (body.id && typeof body.id === "string") {
      clientId = body.id;
    }
    if (isAspectRatio(body.aspect_ratio)) {
      aspectRatio = body.aspect_ratio;
    }
    if (
      body.voice_id &&
      typeof body.voice_id === "string" &&
      /^[a-zA-Z0-9]{8,64}$/.test(body.voice_id)
    ) {
      voiceId = body.voice_id;
    }
  } catch {
    // No-op: defaults are valid.
  }

  try {
    if (clientId) {
      const existing = getLocalSession(clientId);
      if (existing) {
        ensureLocalSessionLayout(existing.id);
        return NextResponse.json({ session: existing });
      }
    }

    const session = createLocalSession({
      id: clientId,
      model,
      aspect_ratio: aspectRatio ?? null,
      voice_id: voiceId ?? null,
    });

    ensureLocalSessionLayout(session.id);

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
