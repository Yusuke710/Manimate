import fsp from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureLocalSessionLayout,
  getSessionIdFromSandboxId,
} from "@/lib/local/config";
import { getLocalSession } from "@/lib/local/db";
import { runLocalCommand } from "@/lib/local/command";

function buildTempFramePath(artifactsDir: string): string {
  return path.join(
    artifactsDir,
    `frame_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.png`
  );
}

function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore cleanup failures.
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get("session_id");
  const sandboxId = searchParams.get("sandbox_id");
  const timestamp = parseTimestamp(searchParams.get("time"));

  if (timestamp === null) {
    return NextResponse.json({ error: "time query parameter is required" }, { status: 400 });
  }

  const resolvedSessionId = sessionId || (sandboxId ? getSessionIdFromSandboxId(sandboxId) : null);
  if (!resolvedSessionId) {
    return NextResponse.json(
      { error: "session_id or sandbox_id is required" },
      { status: 400 }
    );
  }

  const session = getLocalSession(resolvedSessionId);
  if (!session?.video_path) {
    return NextResponse.json({ error: "No video found for this session" }, { status: 404 });
  }

  const { artifactsDir } = ensureLocalSessionLayout(resolvedSessionId);
  const outputPath = buildTempFramePath(artifactsDir);

  try {
    const ffmpeg = await runLocalCommand({
      command: "ffmpeg",
      args: [
        "-y",
        "-i",
        session.video_path,
        "-ss",
        timestamp.toFixed(3),
        "-frames:v",
        "1",
        "-f",
        "image2",
        outputPath,
      ],
      timeoutMs: 20_000,
    });

    if (ffmpeg.exitCode !== 0) {
      return NextResponse.json({ error: "Failed to extract frame" }, { status: 500 });
    }

    const bytes = await fsp.readFile(outputPath);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to extract frame" }, { status: 500 });
  } finally {
    await safeUnlink(outputPath);
  }
}
