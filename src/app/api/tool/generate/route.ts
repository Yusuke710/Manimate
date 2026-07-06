import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, isRegisteredModelId } from "@/lib/models";
import { isAspectRatio } from "@/lib/models";
import { isValidVoiceId } from "@/lib/voices";
import { handleLocalChatRequest } from "@/lib/local/chat";
import { ensureLocalSessionLayout } from "@/lib/local/config";
import {
  createLocalSession,
  getLocalSession,
  updateLocalSession,
} from "@/lib/local/session-store";

type ToolGenerateBody = {
  prompt?: string;
  session_id?: string;
  model?: string;
  aspect_ratio?: string;
  voice_id?: string;
  agent_session_id?: string;
  images?: Array<{
    id: string;
    path: string;
    name: string;
    size: number;
    type: string;
  }>;
};

// Keep parity with /api/chat streaming window.
export const maxDuration = 800;

export async function POST(request: NextRequest): Promise<Response> {
  let body: ToolGenerateBody;
  try {
    body = (await request.json()) as ToolGenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const requestedSessionId =
    typeof body.session_id === "string" && body.session_id.trim()
      ? body.session_id.trim()
      : randomUUID();

  const requestedModelRaw = typeof body.model === "string" ? body.model.trim() : "";
  if (body.model !== undefined && (!requestedModelRaw || !isRegisteredModelId(requestedModelRaw))) {
    return NextResponse.json(
      { error: "Invalid model. Use one of: claude, codex" },
      { status: 400 }
    );
  }
  const requestedModel = requestedModelRaw || null;
  const requestedAspectRatio = isAspectRatio(body.aspect_ratio)
    ? body.aspect_ratio
    : null;
  const requestedVoiceId =
    typeof body.voice_id === "string" && isValidVoiceId(body.voice_id.trim())
      ? body.voice_id.trim()
      : null;
  const requestedAgentSessionId =
    typeof body.agent_session_id === "string" && body.agent_session_id.trim()
      ? body.agent_session_id.trim()
      : null;

  let session = getLocalSession(requestedSessionId);
  if (!session) {
    session = createLocalSession({
      id: requestedSessionId,
      model: requestedModel ?? DEFAULT_MODEL,
      aspect_ratio: requestedAspectRatio,
      voice_id: requestedVoiceId,
    });
  } else {
    // A session is locked to one model for its lifetime (cross-CLI resume is
    // impossible). Legacy sessions with pre-local model ids may adopt one —
    // handleLocalChatRequest performs that adoption.
    if (
      requestedModel &&
      isRegisteredModelId(session.model) &&
      requestedModel !== session.model
    ) {
      return NextResponse.json(
        {
          error: `Session ${session.id} uses ${session.model}. Use POST /api/sessions/${session.id}/handoff to continue with ${requestedModel} in a new session.`,
        },
        { status: 409 }
      );
    }
    const updates: {
      aspect_ratio?: string | null;
      voice_id?: string | null;
    } = {};
    if (requestedAspectRatio && requestedAspectRatio !== session.aspect_ratio) {
      updates.aspect_ratio = requestedAspectRatio;
    }
    if (requestedVoiceId && requestedVoiceId !== session.voice_id) {
      updates.voice_id = requestedVoiceId;
    }
    if (Object.keys(updates).length > 0) {
      updateLocalSession(session.id, updates);
      session = getLocalSession(session.id) || session;
    }
  }

  ensureLocalSessionLayout(session.id, { model: requestedModel ?? session.model });

  const chatBody: Record<string, unknown> = {
    prompt,
    session_id: session.id,
    model: requestedModel ?? session.model,
  };

  const aspectRatioToUse = requestedAspectRatio ?? session.aspect_ratio;
  if (aspectRatioToUse) {
    chatBody.aspect_ratio = aspectRatioToUse;
  }
  if (requestedAgentSessionId) {
    chatBody.agent_session_id = requestedAgentSessionId;
  }
  if (Array.isArray(body.images)) {
    chatBody.images = body.images;
  }

  const internalRequest = new Request("http://local.manimate/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatBody),
    signal: request.signal,
  });

  const upstream = await handleLocalChatRequest(internalRequest);
  const headers = new Headers(upstream.headers);
  headers.set("x-manimate-session-id", session.id);
  headers.set("x-manimate-tool-endpoint", "generate-v1");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
