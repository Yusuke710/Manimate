import { NextRequest, NextResponse } from "next/server";
import { queueLocalCloudSync } from "@/lib/local/cloud-sync";
import {
  getLocalCloudSyncConfig,
  getLocalCloudSyncEnvOverride,
} from "@/lib/local/cloud-sync-config";
import {
  getLocalSession,
  type LocalSession,
} from "@/lib/local/db";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

const CLOUD_SYNC_WAIT_TIMEOUT_MS = 12_000;
const CLOUD_SYNC_POLL_INTERVAL_MS = 600;
const CANONICAL_SHARE_PATH_RE = /^\/share\/[A-Za-z0-9_-]{16,200}$/;
const INVALID_SHARE_LINK_ERROR = "Hosted response did not return a canonical share link.";

type CloudShareSettings = {
  baseUrl: string;
  token: string;
};

type HostedShareLink = {
  token?: string;
  share_path: string;
  share_url: string;
};

class ShareRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ShareRouteError";
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCloudShareSettings(): CloudShareSettings | null {
  const config = getLocalCloudSyncEnvOverride() || getLocalCloudSyncConfig();
  if (config?.base_url && config.token) {
    return {
      baseUrl: config.base_url,
      token: config.token,
    };
  }

  return null;
}

function parseHostedShareLinkPayload(payload: unknown): HostedShareLink {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { share_path?: unknown }).share_path !== "string" ||
    typeof (payload as { share_url?: unknown }).share_url !== "string"
  ) {
    throw new ShareRouteError(INVALID_SHARE_LINK_ERROR, 502);
  }

  const sharePath = (payload as { share_path: string }).share_path;
  const shareUrl = (payload as { share_url: string }).share_url;

  if (!CANONICAL_SHARE_PATH_RE.test(sharePath)) {
    throw new ShareRouteError(INVALID_SHARE_LINK_ERROR, 502);
  }

  try {
    const parsedUrl = new URL(shareUrl);
    if (parsedUrl.pathname !== sharePath || !CANONICAL_SHARE_PATH_RE.test(parsedUrl.pathname)) {
      throw new Error("invalid-share-url");
    }
  } catch {
    throw new ShareRouteError(INVALID_SHARE_LINK_ERROR, 502);
  }

  return {
    token: typeof (payload as { token?: unknown }).token === "string"
      ? (payload as { token: string }).token
      : undefined,
    share_path: sharePath,
    share_url: shareUrl,
  };
}

async function createHostedShareLink(sessionId: string, settings: CloudShareSettings): Promise<HostedShareLink> {
  const response = await fetch(
    `${settings.baseUrl}/api/local-sync/sessions/${encodeURIComponent(sessionId)}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string"
      ? payload.error
      : "Failed to create share link";
    throw new ShareRouteError(message, response.status);
  }

  return parseHostedShareLinkPayload(payload);
}

async function waitForCloudMirrorSync(sessionId: string): Promise<LocalSession> {
  let session = getLocalSession(sessionId);
  if (!session) {
    throw new ShareRouteError("Session not found", 404);
  }

  if (session.cloud_sync_status === "synced") {
    return session;
  }

  if (!session.video_path) {
    throw new ShareRouteError(
      "This session is not ready to share yet. Finish a render first.",
      409,
    );
  }

  queueLocalCloudSync(sessionId);

  const deadline = Date.now() + CLOUD_SYNC_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CLOUD_SYNC_POLL_INTERVAL_MS);
    session = getLocalSession(sessionId);
    if (!session) {
      throw new ShareRouteError("Session not found", 404);
    }
    if (session.cloud_sync_status === "synced") {
      return session;
    }
    if (session.cloud_sync_status === "failed") {
      throw new ShareRouteError(
        session.cloud_last_error || "Cloud sync failed. Try again in a moment.",
        502,
      );
    }
  }

  session = getLocalSession(sessionId);
  throw new ShareRouteError(
    session?.cloud_last_error || "Still syncing to manimate.ai. Try again in a moment.",
    504,
  );
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { sessionId } = await context.params;
  const cloudSettings = getCloudShareSettings();

  if (!cloudSettings) {
    return NextResponse.json(
      { error: "Connect Manimate to manimate.ai before creating a share link." },
      { status: 409 },
    );
  }

  try {
    const syncedSession = await waitForCloudMirrorSync(sessionId);
    const hostedShare = await createHostedShareLink(sessionId, cloudSettings);

    return NextResponse.json({
      session_id: sessionId,
      token: hostedShare.token,
      share_path: hostedShare.share_path,
      share_url: hostedShare.share_url,
      cloud_sync_status: syncedSession.cloud_sync_status,
      cloud_last_synced_at: syncedSession.cloud_last_synced_at,
    });
  } catch (error) {
    if (error instanceof ShareRouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Failed to create share link." },
      { status: 500 },
    );
  }
}
