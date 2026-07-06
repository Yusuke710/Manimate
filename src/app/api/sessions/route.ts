/**
 * Local Sessions API Route
 *
 * GET  /api/sessions - List sessions
 * POST /api/sessions - Create session
 */

import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import { isAspectRatio, type AspectRatio } from "@/lib/aspect-ratio";
import { isValidVoiceId } from "@/lib/voices";
import {
  createLocalSession,
  getLocalSession,
  listLocalSessions,
  listLocalSessionSummaries,
  readLocalSessionArtifacts,
} from "@/lib/local/session-store";
import { ensureLocalSessionLayout } from "@/lib/local/config";

export async function GET(request: NextRequest): Promise<Response> {
  const includeSearchContent =
    request.nextUrl.searchParams.get("include_search_content") === "1";

  if (!includeSearchContent) {
    return NextResponse.json(listLocalSessionSummaries());
  }

  const sessions = listLocalSessions();
  const sessionsWithVideo = sessions.map((session) => {
    const artifacts = readLocalSessionArtifacts(session.id);
    return {
      ...session,
      plan_content: artifacts.plan_content,
      script_content: artifacts.script_content,
      has_video: Boolean(
        session.video_path ||
        session.last_video_url ||
        session.cloud_public_video_url
      ),
    };
  });
  return NextResponse.json(sessionsWithVideo);
}

export async function POST(request: NextRequest): Promise<Response> {
  let model = DEFAULT_MODEL;
  let clientId: string | undefined;
  let aspectRatio: AspectRatio | undefined;
  let voiceId: string | undefined;

  try {
    const body = await request.json();
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    if (body.model !== undefined) {
      if (!requestedModel || !isRegisteredModelId(requestedModel)) {
        return NextResponse.json(
          { error: "Invalid model. Use one of: claude, codex" },
          { status: 400 }
        );
      }
      model = requestedModel;
    }
    if (body.id && typeof body.id === "string") {
      clientId = body.id;
    }
    if (isAspectRatio(body.aspect_ratio)) {
      aspectRatio = body.aspect_ratio;
    }
    if (body.voice_id && typeof body.voice_id === "string" && isValidVoiceId(body.voice_id)) {
      voiceId = body.voice_id;
    }
  } catch {
    // No-op: defaults are valid.
  }

  try {
    if (clientId) {
      const existing = getLocalSession(clientId);
      if (existing) {
        ensureLocalSessionLayout(existing.id, { model: existing.model });
        return NextResponse.json({ session: existing });
      }
    }

    const session = createLocalSession({
      id: clientId,
      model,
      aspect_ratio: aspectRatio ?? null,
      voice_id: voiceId ?? null,
    });

    ensureLocalSessionLayout(session.id, { model: session.model });

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
