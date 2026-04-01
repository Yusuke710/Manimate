import { NextRequest, NextResponse } from "next/server";
import {
  clearSavedElevenLabsApiKey,
  getElevenLabsApiKeyStatus,
  writeSavedElevenLabsApiKey,
} from "@/lib/local/elevenlabs-config";

export const runtime = "nodejs";

type SaveElevenLabsApiKeyBody = {
  apiKey?: string;
};

function toResponseBody() {
  const status = getElevenLabsApiKeyStatus();
  return {
    configured: status.configured,
    source: status.source,
    masked_key: status.maskedKey,
  };
}

export async function GET(): Promise<Response> {
  return NextResponse.json(toResponseBody());
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: SaveElevenLabsApiKeyBody = {};
  try {
    body = (await request.json()) as SaveElevenLabsApiKeyBody;
  } catch {
    body = {};
  }

  try {
    writeSavedElevenLabsApiKey(body.apiKey ?? "");
    return NextResponse.json(toResponseBody());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save ElevenLabs API key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(): Promise<Response> {
  clearSavedElevenLabsApiKey();
  return NextResponse.json(toResponseBody());
}
