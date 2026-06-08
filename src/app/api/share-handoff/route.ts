import { NextRequest, NextResponse } from "next/server";
import { getDefaultCloudSyncBaseUrl } from "@/lib/local/cloud-sync-connect";
import {
  createHandoffFromSharedSnapshot,
  type SharedHandoffSnapshot,
} from "@/lib/local/handoff";

const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;

type SharedHandoffRequest = {
  token?: unknown;
  share_url?: unknown;
};

class SharedHandoffError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SharedHandoffError";
    this.status = status;
  }
}

function isAllowedShareOrigin(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host === "manimate.ai" ||
    host === "www.manimate.ai"
  );
}

function parseShareInput(payload: SharedHandoffRequest): {
  token: string;
  baseUrl: string;
} {
  const rawToken = typeof payload.token === "string" ? payload.token.trim() : "";
  if (SHARE_TOKEN_RE.test(rawToken)) {
    return {
      token: rawToken,
      baseUrl: getDefaultCloudSyncBaseUrl(),
    };
  }

  const rawShareUrl = typeof payload.share_url === "string" ? payload.share_url.trim() : "";
  if (!rawShareUrl) {
    throw new SharedHandoffError("Paste a Manimate share link to continue locally.", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawShareUrl);
  } catch {
    throw new SharedHandoffError("That does not look like a valid share link.", 400);
  }

  if (!isAllowedShareOrigin(parsed)) {
    throw new SharedHandoffError("Only Manimate share links can be continued locally.", 400);
  }

  const match = parsed.pathname.match(/^\/share\/([A-Za-z0-9_-]{16,200})$/);
  if (!match) {
    throw new SharedHandoffError("That does not look like a valid Manimate share link.", 400);
  }

  return {
    token: match[1],
    baseUrl: parsed.origin,
  };
}

async function fetchSharedSnapshot(
  token: string,
  baseUrl: string,
): Promise<SharedHandoffSnapshot> {
  const response = await fetch(
    `${baseUrl}/api/share/${encodeURIComponent(token)}/handoff`,
    { cache: "no-store" },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload.error === "string"
      ? payload.error
      : "Failed to load shared session";
    throw new SharedHandoffError(message, response.status);
  }

  return payload as SharedHandoffSnapshot;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const payload = await request.json().catch(() => ({})) as SharedHandoffRequest;
    const { token, baseUrl } = parseShareInput(payload);
    const snapshot = await fetchSharedSnapshot(token, baseUrl);
    return NextResponse.json(await createHandoffFromSharedSnapshot(snapshot));
  } catch (error) {
    if (error instanceof SharedHandoffError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error
      ? error.message
      : "Failed to continue shared session locally";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
