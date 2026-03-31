import { NextResponse } from "next/server";
import { getLocalCloudSyncStatus } from "@/lib/local/cloud-sync-connect";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return NextResponse.json(await getLocalCloudSyncStatus());
}
