/**
 * Local Sessions API Route
 *
 * GET  /api/sessions            - Lightweight summaries (sidebar)
 * GET  /api/sessions?full=1     - Full session metadata (library)
 * GET  /api/sessions?full=1&q=… - Server-side library search over
 *                                 title + plan.md + script.py. Artifact
 *                                 content never leaves the server.
 * POST /api/sessions            - Create session
 */

import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import { isAspectRatio, type AspectRatio } from "@/lib/models";
import { isValidVoiceId } from "@/lib/voices";
import { matchesLibrarySearch } from "@/lib/library-search";
import {
  createLocalSession,
  getLocalSession,
  listLocalSessions,
  listLocalSessionSummaries,
  readLocalSessionArtifacts,
} from "@/lib/local/session-store";
import { ensureLocalSessionLayout } from "@/lib/local/config";

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const full = params.get("full") === "1";
  const query = (params.get("q") || "").trim();

  if (!full) {
    return NextResponse.json(listLocalSessionSummaries());
  }

  const sessions = listLocalSessions().map((session) => ({
    ...session,
    has_video: Boolean(
      session.video_path ||
      session.last_video_url ||
      session.cloud_public_video_url
    ),
  }));

  if (!query) {
    return NextResponse.json(sessions);
  }

  // Search runs here rather than in the browser so plan/script content
  // (tens of MB across the library) is never serialized into a response.
  // Sessions are processed sequentially on purpose: the await between
  // iterations yields the event loop, so fuzzy-matching hundreds of scripts
  // never starves SSE streams of concurrently running renders.
  const matches: typeof sessions = [];
  for (const session of sessions) {
    if (!session.has_video) continue;
    if (matchesLibrarySearch({ title: session.title }, query)) {
      matches.push(session);
      continue;
    }
    const artifacts = await readLocalSessionArtifacts(session.id);
    const record = {
      title: session.title,
      plan_content: artifacts.plan_content,
      script_content: artifacts.script_content,
    };
    if (matchesLibrarySearch(record, query)) {
      matches.push(session);
    }
  }
  return NextResponse.json(matches);
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
