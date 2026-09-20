import { NextRequest, NextResponse } from "next/server";
import {
  ensureLocalSessionLayout,
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

  const stored = parseStoredLocalChapters(session.chapters);
  if (stored.length > 0) {
    return responseWithNoCache(stored);
  }

  const { projectDir } = ensureLocalSessionLayout(sessionId);

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
