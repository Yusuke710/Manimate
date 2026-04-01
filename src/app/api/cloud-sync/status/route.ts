import { NextResponse } from "next/server";
import { getLocalCloudSyncStatus } from "@/lib/local/cloud-sync-connect";

export const runtime = "nodejs";
const STUDIO_MARKER_HEADER_NAME = "x-manimate-studio";
const STUDIO_MARKER_HEADER_VALUE = "local";

export async function GET(): Promise<Response> {
  return NextResponse.json(await getLocalCloudSyncStatus(), {
    headers: {
      "Cache-Control": "no-store",
      [STUDIO_MARKER_HEADER_NAME]: STUDIO_MARKER_HEADER_VALUE,
    },
  });
}
