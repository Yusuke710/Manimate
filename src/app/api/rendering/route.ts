import { NextRequest, NextResponse } from "next/server";
import { connectRenderer, renderConnection, selectRenderMode } from "@/lib/local/render-connection";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json(await renderConnection(), {headers: {"Cache-Control": "no-store"}});
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    if (!origin || new URL(origin).host !== request.headers.get("host")) return new Response("Invalid origin", {status: 403});
  } catch { return new Response("Invalid origin", {status: 403}); }
  try {
    const body = await request.json();
    if (body.mode === "local" || body.mode === "cloud") selectRenderMode(body.mode);
    else if (body.action !== "connect") return NextResponse.json({error: "Choose local or cloud"}, {status: 400});
    return NextResponse.json(body.action === "connect" ? await connectRenderer() : await renderConnection());
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "Connection failed"}, {status: 400});
  }
}
