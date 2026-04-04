import { NextResponse } from "next/server";
import { getLocalCloudSyncStatus } from "@/lib/local/cloud-sync-connect";
import packageMetadata from "../../../../../package.json";

export const runtime = "nodejs";
const STUDIO_MARKER_HEADER_NAME = "x-manimate-studio";
const STUDIO_MARKER_HEADER_VALUE = "local";
const APP_VERSION = typeof packageMetadata.version === "string" ? packageMetadata.version : null;

export async function GET(): Promise<Response> {
  const status = await getLocalCloudSyncStatus();

  return NextResponse.json(APP_VERSION ? { ...status, version: APP_VERSION } : status, {
    headers: {
      "Cache-Control": "no-store",
      [STUDIO_MARKER_HEADER_NAME]: STUDIO_MARKER_HEADER_VALUE,
    },
  });
}
