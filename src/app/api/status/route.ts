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

export function GET(): Response {
  return NextResponse.json({status: "ready", version: packageMetadata.version, build_id: buildId}, {
    headers: {"Cache-Control": "no-store", "x-manimate-studio": "local"},
  });
}
