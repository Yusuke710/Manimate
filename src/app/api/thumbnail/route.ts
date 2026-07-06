/**
 * Thumbnail API Route
 *
 * GET /api/thumbnail?session_id=<id>
 *
 * Serves the pre-generated thumbnail.jpg from the session directory.
 * Thumbnails are generated at video completion time (chat.ts) using ffmpeg's
 * `thumbnail` filter. This route never generates thumbnails on read.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { getLocalSession } from "@/lib/local/session-store";
import { getLocalSessionPaths } from "@/lib/local/config";
import { getExistingThumbnailPath } from "@/lib/local/thumbnail";

export async function GET(request: NextRequest): Promise<Response> {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId) return new Response(null, { status: 400 });

  const session = getLocalSession(sessionId);
  if (!session) return new Response(null, { status: 404 });

  const { sessionRoot } = getLocalSessionPaths(sessionId);
  const thumbPath = getExistingThumbnailPath(sessionRoot);
  if (!thumbPath) return new Response(null, { status: 404 });

  try {
    const data = readFileSync(thumbPath);
    return new Response(data, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
