import { NextRequest, NextResponse } from "next/server";
import {
  ensureLocalSessionLayout,
  getSessionIdFromSandboxId,
} from "@/lib/local/config";
import fsp from "node:fs/promises";
import path from "node:path";
import { getLocalSession } from "@/lib/local/session-store";
import { readLocalProjectSubtitles } from "@/lib/local/subtitles";

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

  const { projectDir } = ensureLocalSessionLayout(resolvedSessionId);
  const content = await readLocalProjectSubtitles(projectDir);
  if (content?.trim()) {
    // Cache the derived subtitles as a plain project file (replaces the old
    // subtitles_content DB column).
    const cachePath = path.join(projectDir, "subtitles.srt");
    const cached = await fsp.readFile(cachePath, "utf8").catch(() => null);
    if (content !== cached) {
      await fsp.writeFile(cachePath, content, "utf8").catch(() => {});
    }
    return subtitleResponse(content);
  }

  return NextResponse.json({ error: "No subtitles found" }, { status: 404 });
}
