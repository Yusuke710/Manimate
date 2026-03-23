/**
 * Thumbnail API Route
 *
 * GET /api/thumbnail?session_id=<id>
 *
 * Serves the pre-generated thumbnail.jpg from the session directory.
 * Thumbnails are generated at video completion time (chat.ts) using ffmpeg's
 * `thumbnail` filter. This route falls back to lazy generation for older
 * sessions that predate the push-based generation.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { getLocalSession } from "@/lib/local/db";
import { getLocalSessionPaths } from "@/lib/local/config";
import { ensureThumbnail } from "@/lib/local/thumbnail";

export async function GET(request: NextRequest): Promise<Response> {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId) return new Response(null, { status: 400 });

  const session = getLocalSession(sessionId);
  if (!session) return new Response(null, { status: 404 });

  const { sessionRoot } = getLocalSessionPaths(sessionId);
  const thumbPath = await ensureThumbnail(sessionRoot, session.video_path);
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
