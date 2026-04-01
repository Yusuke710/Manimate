import { NextRequest, NextResponse } from "next/server";
import { getResolvedElevenLabsApiKey } from "@/lib/local/elevenlabs-config";

export const runtime = "nodejs";

/**
 * GET /api/voices/{voiceId} — Resolve voice name from ElevenLabs (local mode, no auth gate)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ voiceId: string }> }
) {
  const { voiceId } = await params;

  if (!voiceId || voiceId.length > 64 || !/^[a-zA-Z0-9]+$/.test(voiceId)) {
    return NextResponse.json({ error: "Invalid voice ID" }, { status: 400 });
  }

  const apiKey = getResolvedElevenLabsApiKey().apiKey;
  if (!apiKey) {
    return NextResponse.json({ error: "ElevenLabs not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ voiceId, name: data.name });
    }

    const body = await res.json().catch(() => null);
    const status = body?.detail?.status;

    if (status === "missing_permissions") {
      return NextResponse.json({ error: "missing_permissions", voiceId }, { status: 403 });
    }

    return NextResponse.json({ error: "Voice not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Failed to resolve voice" }, { status: 502 });
  }
}
