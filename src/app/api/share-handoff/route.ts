import { NextRequest, NextResponse } from "next/server";
import { getDefaultCloudSyncBaseUrl } from "@/lib/local/cloud-sync";
import {
  createHandoffFromSharedSnapshot,
  type SharedHandoffSnapshot,
} from "@/lib/local/handoff";

const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;

type SharedHandoffRequest = {
  token?: unknown;
};

class SharedHandoffError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SharedHandoffError";
    this.status = status;
  }
}

function parseShareToken(payload: SharedHandoffRequest): string {
  const rawToken = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!SHARE_TOKEN_RE.test(rawToken)) {
    throw new SharedHandoffError("Missing or invalid share token.", 400);
  }

  return rawToken;
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
    const token = parseShareToken(payload);
    const snapshot = await fetchSharedSnapshot(token, getDefaultCloudSyncBaseUrl());
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
