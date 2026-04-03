import { NextRequest, NextResponse } from "next/server";
import os from "node:os";
import { beginOrResumeLocalCloudSyncConnect, getDefaultCloudSyncBaseUrl } from "@/lib/local/cloud-sync-connect";

export const runtime = "nodejs";

type RequestBody = {
  reopen?: boolean;
};

export async function POST(request: NextRequest): Promise<Response> {
  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
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
