import fsp from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  getLocalSessionPaths,
} from "@/lib/local/config";
import { getLocalSession, updateLocalSession } from "@/lib/local/session-store";
import {
  parseStoredLocalChapters,
  readLocalProjectChapters,
  serializeLocalChapters,
  type LocalChapter,
} from "@/lib/local/chapters";

function responseWithNoCache(chapters: LocalChapter[]): Response {
  return NextResponse.json(chapters, {
    status: 200,
    headers: { "Cache-Control": "no-cache" },
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // An unedited handoff has only the final video and supplied chapter metadata,
  // not its source clips. Keep that metadata only for the same video version.
  if (session.agent_session_id === null && session.video_path && session.last_video_url) {
    const stored = parseStoredLocalChapters(session.chapters);
    const version = new URL(session.last_video_url, "http://localhost").searchParams.get("_v");
    const stat = await fsp.stat(session.video_path).catch(() => null);
    if (stored.length && version && stat && String(Math.round(stat.mtimeMs)) === version) {
      return responseWithNoCache(stored);
    }
  }

  const { projectDir } = getLocalSessionPaths(sessionId);

  try {
    const chapters = await readLocalProjectChapters(projectDir);
    const serialized = serializeLocalChapters(chapters);
    if (serialized !== session.chapters) {
      updateLocalSession(sessionId, { chapters: serialized });
    }
    return responseWithNoCache(chapters);
  } catch {
    return responseWithNoCache([]);
  }
}
