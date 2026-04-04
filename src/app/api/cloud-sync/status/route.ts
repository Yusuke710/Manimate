import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getLocalCloudSyncStatus } from "@/lib/local/cloud-sync-connect";
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

export async function GET(): Promise<Response> {
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
