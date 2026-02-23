import { NextRequest, NextResponse } from "next/server";
import { startLocalVoiceoverJob } from "@/lib/local/voiceover";

interface VoiceoverRequest {
  session_id?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: VoiceoverRequest;
  try {
    body = (await request.json()) as VoiceoverRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.session_id?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const result = await startLocalVoiceoverJob(sessionId, { force: true });

  if (!result.started) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json(
    {
      success: true,
      message: result.message,
      status: "pending",
    },
    { status: result.status }
  );
}
