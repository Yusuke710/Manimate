import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import {
  getSessionIdFromSandboxId,
  resolveSessionFilePath,
} from "@/lib/local/config";
import { getLocalSession } from "@/lib/local/db";

const MIME_BY_EXT: Record<string, { mime: string; binary: boolean }> = {
  ".py": { mime: "text/x-python", binary: false },
  ".md": { mime: "text/markdown", binary: false },
  ".txt": { mime: "text/plain", binary: false },
  ".json": { mime: "application/json", binary: false },
  ".srt": { mime: "text/plain", binary: false },
  ".png": { mime: "image/png", binary: true },
  ".jpg": { mime: "image/jpeg", binary: true },
  ".jpeg": { mime: "image/jpeg", binary: true },
  ".webp": { mime: "image/webp", binary: true },
  ".gif": { mime: "image/gif", binary: true },
  ".pdf": { mime: "application/pdf", binary: true },
  ".mp4": { mime: "video/mp4", binary: true },
};

function parseRangeHeader(rangeHeader: string | null, fileSize: number): { start: number; end: number } | null {
  if (!rangeHeader?.startsWith("bytes=")) return null;
  const [startStr, endStr] = rangeHeader.slice(6).split("-");

  let start = Number.parseInt(startStr, 10);
  let end = endStr ? Number.parseInt(endStr, 10) : fileSize - 1;

  if (Number.isNaN(start)) {
    start = fileSize - end;
    end = fileSize - 1;
  }

  if (start < 0 || start >= fileSize || end < start || end >= fileSize) {
    return null;
  }

  return { start, end };
}

function resolveSessionFromQuery(request: NextRequest): { sessionId: string } | { error: Response } {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get("session_id");
  const sandboxId = searchParams.get("sandbox_id");

  const resolvedSessionId = sessionId || (sandboxId ? getSessionIdFromSandboxId(sandboxId) : null);
  if (!resolvedSessionId) {
    return { error: NextResponse.json({ error: "session_id or sandbox_id is required" }, { status: 400 }) };
  }

  const session = getLocalSession(resolvedSessionId);
  if (!session) {
    return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  }

  return { sessionId: resolvedSessionId };
}

function resolveMime(filePath: string): { mime: string; binary: boolean } {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || { mime: "application/octet-stream", binary: true };
}

export async function GET(request: NextRequest): Promise<Response> {
  const sessionResult = resolveSessionFromQuery(request);
  if ("error" in sessionResult) return sessionResult.error;

  const requestedPath = request.nextUrl.searchParams.get("path");
  if (!requestedPath) {
    return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
  }

  const resolvedPath = resolveSessionFilePath(sessionResult.sessionId, requestedPath);
  if (!resolvedPath) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const stats = await fsp.stat(resolvedPath);
    if (!stats.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const { mime, binary } = resolveMime(resolvedPath);
    const rangeHeader = request.headers.get("Range");

    if (binary && rangeHeader) {
      const range = parseRangeHeader(rangeHeader, stats.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${stats.size}`,
          },
        });
      }

      const stream = fs.createReadStream(resolvedPath, {
        start: range.start,
        end: range.end,
      });

      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(range.end - range.start + 1),
          "Content-Range": `bytes ${range.start}-${range.end}/${stats.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    if (binary) {
      const stream = fs.createReadStream(resolvedPath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(stats.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    const text = await fsp.readFile(resolvedPath, "utf8");
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

export async function HEAD(request: NextRequest): Promise<Response> {
  const sessionResult = resolveSessionFromQuery(request);
  if ("error" in sessionResult) {
    return new Response(null, { status: sessionResult.error.status });
  }

  const requestedPath = request.nextUrl.searchParams.get("path");
  if (!requestedPath) {
    return new Response(null, { status: 400 });
  }

  const resolvedPath = resolveSessionFilePath(sessionResult.sessionId, requestedPath);
  if (!resolvedPath) {
    return new Response(null, { status: 400 });
  }

  try {
    const stats = await fsp.stat(resolvedPath);
    if (!stats.isFile()) return new Response(null, { status: 404 });

    const { mime, binary } = resolveMime(resolvedPath);
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stats.size),
        "Accept-Ranges": binary ? "bytes" : "none",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
