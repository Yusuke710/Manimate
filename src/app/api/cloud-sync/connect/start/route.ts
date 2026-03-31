import { NextRequest, NextResponse } from "next/server";
import os from "node:os";
import { getLocalCloudSyncConfig, getLocalCloudSyncEnvOverride, getLocalCloudSyncPendingConnect } from "@/lib/local/cloud-sync-config";
import { beginLocalCloudSyncConnect, mapConnectedStatus, mapPendingStatus, openExternalBrowser } from "@/lib/local/cloud-sync-connect";

export const runtime = "nodejs";

type RequestBody = {
  reopen?: boolean;
};

export async function POST(request: NextRequest): Promise<Response> {
  const envOverride = getLocalCloudSyncEnvOverride();
  if (envOverride) {
    return NextResponse.json(mapConnectedStatus(envOverride));
  }

  const existingConfig = getLocalCloudSyncConfig();
  if (existingConfig) {
    return NextResponse.json(mapConnectedStatus(existingConfig));
  }

  const pending = getLocalCloudSyncPendingConnect();
  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = {};
  }

  if (pending) {
    return NextResponse.json({
      ...mapPendingStatus(pending),
      browser_opened: body.reopen === true ? openExternalBrowser(pending.connect_url) : false,
    });
  }

  try {
    const started = await beginLocalCloudSyncConnect({
      baseUrl: process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "https://manimate.ai",
      deviceName: os.hostname(),
      reopen: body.reopen !== false,
    });
    return NextResponse.json(started);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start cloud sync connection";
    return NextResponse.json({
      status: "error",
      connected: false,
      base_url: process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "https://manimate.ai",
      message,
    }, { status: 500 });
  }
}
