import { NextRequest, NextResponse } from "next/server";
import {
  ensureLocalSessionLayout,
  getSessionIdFromSandboxId,
} from "@/lib/local/config";
import { getLocalSession, updateLocalSession } from "@/lib/local/db";
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

  const stored = parseStoredLocalChapters(session.chapters);
  if (stored.length > 0) {
    return responseWithNoCache(stored);
  }

  const { projectDir } = ensureLocalSessionLayout(resolvedSessionId);

  try {
    const chapters = await readLocalProjectChapters(projectDir);
    const serialized = serializeLocalChapters(chapters);
    if (serialized !== session.chapters) {
      updateLocalSession(resolvedSessionId, { chapters: serialized });
    }
    return responseWithNoCache(chapters);
  } catch {
    return responseWithNoCache([]);
  }
}
