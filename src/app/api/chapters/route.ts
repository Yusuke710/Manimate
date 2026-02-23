import { NextRequest, NextResponse } from "next/server";
import { getSessionIdFromSandboxId } from "@/lib/local/config";
import { getLocalSession } from "@/lib/local/db";

export interface Chapter {
  name: string;
  start: number;
  duration: number;
}

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get("session_id");
  const sandboxId = searchParams.get("sandbox_id");

  const resolvedSessionId = sessionId || (sandboxId ? getSessionIdFromSandboxId(sandboxId) : null);
  if (!resolvedSessionId) {
    return NextResponse.json(
      { error: "Either session_id or sandbox_id is required" },
      { status: 400 }
    );
  }

  const session = getLocalSession(resolvedSessionId);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json([], {
    status: 200,
    headers: { "Cache-Control": "no-cache" },
  });
}
