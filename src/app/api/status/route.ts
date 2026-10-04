import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import packageMetadata from "../../../../package.json";

const packageRoot = process.env.MANIMATE_PACKAGE_ROOT?.trim() || process.cwd();
function readBuildId(): string | null {
  try { return fs.readFileSync(path.join(packageRoot, ".next", "BUILD_ID"), "utf8").trim() || null; }
  catch { return null; }
}
const buildId = readBuildId();

// Only the public website may discover a local instance. No session data is exposed.
function discoveryHeaders(request: Request): Headers {
  const headers = new Headers({"Cache-Control": "no-store", "x-manimate-studio": "local", "Vary": "Origin"});
  const origin = request.headers.get("Origin");
  if (origin === "https://manimate.ai" || origin === "https://www.manimate.ai") {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "x-manimate-studio");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Private-Network", "true");
  }
  return headers;
}
export function GET(request: Request): Response {
  return NextResponse.json({status: "ready", studio: "manimate-local", capabilities: {shared_handoff: true}, version: packageMetadata.version, build_id: buildId}, {
    headers: discoveryHeaders(request),
  });
}
export function OPTIONS(request: Request): Response {
  return new Response(null, {status: 204, headers: discoveryHeaders(request)});
}
