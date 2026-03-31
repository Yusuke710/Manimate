import { NextResponse } from "next/server";
import { getLocalCloudSyncConfig, getLocalCloudSyncEnvOverride, getLocalCloudSyncPendingConnect } from "@/lib/local/cloud-sync-config";
import { mapConnectedStatus, refreshPendingCloudSyncConnect, type LocalCloudSyncStatus } from "@/lib/local/cloud-sync-connect";

export const runtime = "nodejs";

function disconnectedStatus(baseUrl: string): LocalCloudSyncStatus {
  return {
    status: "disconnected",
    connected: false,
    base_url: baseUrl,
  };
}

export async function GET(): Promise<Response> {
  const envOverride = getLocalCloudSyncEnvOverride();
  if (envOverride) {
    return NextResponse.json(mapConnectedStatus(envOverride));
  }

  const config = getLocalCloudSyncConfig();
  if (config) {
    return NextResponse.json(mapConnectedStatus(config));
  }

  const pending = getLocalCloudSyncPendingConnect();
  if (pending) {
    return NextResponse.json(await refreshPendingCloudSyncConnect(pending));
  }

  return NextResponse.json(disconnectedStatus(process.env.MANIMATE_CLOUD_SYNC_URL?.trim() || "https://manimate.ai"));
}
