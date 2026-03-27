import { NextRequest, NextResponse } from "next/server";
import { getSessionIdFromSandboxId } from "@/lib/local/config";
import {
  getLocalRun,
  insertLocalMessage,
  updateLocalRun,
} from "@/lib/local/db";
import { cancelLocalRunProcess } from "@/lib/local/runtime";

interface CancelRequest {
  sandbox_id?: string;
  session_id?: string;
  command_pid?: number;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json()) as CancelRequest;
    const sandboxId = body.sandbox_id;
    const sessionId = body.session_id || (sandboxId ? getSessionIdFromSandboxId(sandboxId) : null);

    if (!sandboxId && !sessionId) {
      return NextResponse.json(
        { error: "sandbox_id or session_id is required" },
        { status: 400 }
      );
    }

    const result = await cancelLocalRunProcess({
      sandboxId: sandboxId ?? null,
      sessionId: sessionId ?? null,
      pid: Number.isInteger(body.command_pid) ? body.command_pid : null,
    });

    if (result.runId) {
      const run = getLocalRun(result.runId);
      if (run && (run.status === "queued" || run.status === "running")) {
        updateLocalRun(result.runId, {
          status: "canceled",
          finished_at: new Date().toISOString(),
          error_message: "Stopped by user",
        });
        insertLocalMessage({
          session_id: run.session_id,
          role: "assistant",
          content: "Stopped by user",
        });
      }
    }

    return NextResponse.json({
      success: result.success,
      message: result.message,
      run_id: result.runId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
