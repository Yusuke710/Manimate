import { NextRequest, NextResponse } from "next/server";
import {
  getLocalSessionPaths,
} from "@/lib/local/config";
import fsp from "node:fs/promises";
import path from "node:path";
import { getLocalSession } from "@/lib/local/session-store";
import { readLocalProjectSubtitles } from "@/lib/local/voiceover";

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

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  const session = getLocalSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { projectDir } = getLocalSessionPaths(sessionId);
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

  // Handoffs and restored sessions may contain only the final SRT, without
  // narration timestamps or individual scene outputs to derive it again.
  const saved = await fsp.readFile(path.join(projectDir, "subtitles.srt"), "utf8").catch(() => null);
  if (saved?.trim()) return subtitleResponse(saved);
  return NextResponse.json({ error: "No subtitles found" }, { status: 404 });
}
