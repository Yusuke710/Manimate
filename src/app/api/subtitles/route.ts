import fsp from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureLocalSessionLayout,
  getSessionIdFromSandboxId,
} from "@/lib/local/config";
import { getLocalSession } from "@/lib/local/db";

function subtitleResponse(content: string): Response {
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache",
    },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get("session_id");
  const sandboxId = searchParams.get("sandbox_id");

  const resolvedSessionId = sessionId || (sandboxId ? getSessionIdFromSandboxId(sandboxId) : null);
  if (!resolvedSessionId) {
    return NextResponse.json(
      { error: "Either session_id or sandbox_id query parameter is required" },
      { status: 400 }
    );
  }

  const session = getLocalSession(resolvedSessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.subtitles_content && session.subtitles_content.trim()) {
    return subtitleResponse(session.subtitles_content);
  }

  const { projectDir } = ensureLocalSessionLayout(resolvedSessionId);
  const subtitlePath = path.join(projectDir, "subtitles.srt");

  try {
    const fileContent = await fsp.readFile(subtitlePath, "utf8");
    if (!fileContent.trim()) {
      return NextResponse.json({ error: "No subtitles found" }, { status: 404 });
    }
    return subtitleResponse(fileContent);
  } catch {
    return NextResponse.json({ error: "No subtitles found" }, { status: 404 });
  }
}
