import { NextResponse } from "next/server";

/**
 * Local mode: no remote sandbox prewarming required.
 */
export async function POST(): Promise<Response> {
  return new NextResponse(null, { status: 204 });
}
