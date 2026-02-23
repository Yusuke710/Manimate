import { NextRequest } from "next/server";
import { handleLocalChatRequest } from "@/lib/local/chat";

// Keep parity with prior max streaming window.
export const maxDuration = 800;

export async function POST(request: NextRequest): Promise<Response> {
  return handleLocalChatRequest(request);
}
