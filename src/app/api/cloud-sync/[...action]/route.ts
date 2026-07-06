/**
 * Cloud sync API — one route for all hosted-Manimate actions:
 *
 * GET  /api/cloud-sync/status         current connection status (+ version/build)
 * POST /api/cloud-sync/connect/start  begin or resume the device-code connect flow
 * POST /api/cloud-sync/retry          re-queue snapshot sync for eligible sessions
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  beginOrResumeLocalCloudSyncConnect,
  getDefaultCloudSyncBaseUrl,
  getLocalCloudSyncStatus,
  queueLocalCloudSync,
} from "@/lib/local/cloud-sync";
import {
  getLocalSession,
  listLocalCloudSyncRetryCandidates,
} from "@/lib/local/session-store";
import packageMetadata from "../../../../../package.json";

export const runtime = "nodejs";

const STUDIO_MARKER_HEADER_NAME = "x-manimate-studio";
const STUDIO_MARKER_HEADER_VALUE = "local";
const PACKAGE_ROOT = process.env.MANIMATE_PACKAGE_ROOT?.trim() || process.cwd();
const APP_VERSION = typeof packageMetadata.version === "string" ? packageMetadata.version : null;

function readAppBuildId(): string | null {
  const candidates = [
    path.join(PACKAGE_ROOT, ".next", "BUILD_ID"),
    path.join(process.cwd(), ".next", "BUILD_ID"),
  ];

  for (const candidate of candidates) {
    try {
      const buildId = fs.readFileSync(candidate, "utf8").trim();
      if (buildId) return buildId;
    } catch {}
  }

  return null;
}

export const APP_BUILD_ID = readAppBuildId();

interface RouteContext {
  params: Promise<{ action: string[] }>;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { action } = await context.params;
  if (action.join("/") !== "status") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = await getLocalCloudSyncStatus();

  return NextResponse.json({
    ...status,
    ...(APP_VERSION ? { version: APP_VERSION } : {}),
    build_id: APP_BUILD_ID,
  }, {
    headers: {
      "Cache-Control": "no-store",
      [STUDIO_MARKER_HEADER_NAME]: STUDIO_MARKER_HEADER_VALUE,
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { action } = await context.params;

  switch (action.join("/")) {
    case "connect/start":
      return connectStart(request);
    case "retry":
      return retry(request);
    default:
      return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

async function connectStart(request: NextRequest): Promise<Response> {
  let body: { reopen?: boolean } = {};
  try {
    body = (await request.json()) as { reopen?: boolean };
  } catch {
    body = {};
  }

  try {
    const started = await beginOrResumeLocalCloudSyncConnect({
      baseUrl: getDefaultCloudSyncBaseUrl(),
      deviceName: os.hostname(),
      reopen: body.reopen !== false,
    });
    return NextResponse.json(started);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start cloud sync connection";
    return NextResponse.json({
      status: "error",
      base_url: getDefaultCloudSyncBaseUrl(),
      message,
    }, { status: 500 });
  }
}

async function retry(request: NextRequest): Promise<Response> {
  let sessionId: string | null = null;

  try {
    const body = await request.json().catch(() => null) as { session_id?: unknown } | null;
    sessionId = typeof body?.session_id === "string" && body.session_id.trim().length > 0
      ? body.session_id.trim()
      : null;
  } catch {
    sessionId = null;
  }

  const targets = sessionId
    ? (() => {
        const session = getLocalSession(sessionId);
        if (!session || !session.video_path || session.cloud_sync_status === "synced") {
          return [];
        }
        return [session];
      })()
    : listLocalCloudSyncRetryCandidates({ includeAuthFailures: true });

  for (const session of targets) {
    queueLocalCloudSync(session.id);
  }

  return NextResponse.json({
    queued_session_ids: targets.map((session) => session.id),
    count: targets.length,
  });
}
