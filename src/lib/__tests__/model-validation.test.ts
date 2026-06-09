import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

describe("model validation", () => {
  afterEach(() => {
    vi.resetModules();
    if (ORIGINAL_LOCAL_ROOT === undefined) {
      delete process.env.MANIMATE_LOCAL_ROOT;
    } else {
      process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
    }
  });

  it("rejects invalid models when creating a session", async () => {
    const { POST } = await import("@/app/api/sessions/route");
    const response = await POST(
      new NextRequest("http://localhost/api/sessions", {
        method: "POST",
        body: JSON.stringify({ model: "opus" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid model. Use one of: claude, codex",
    });
  });

  it("rejects invalid models for tool generation", async () => {
    const { POST } = await import("@/app/api/tool/generate/route");
    const response = await POST(
      new NextRequest("http://localhost/api/tool/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "Animate vectors", model: "sonnet" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid model. Use one of: claude, codex",
    });
  });

  it("rejects invalid models in the local chat stream", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-model-validation-"));
    process.env.MANIMATE_LOCAL_ROOT = root;
    vi.resetModules();

    const { handleLocalChatRequest } = await import("@/lib/local/chat");
    const response = await handleLocalChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "session-1",
          prompt: "Animate vectors",
          model: "haiku",
        }),
      })
    );

    expect(response.status).toBe(200);
    const rawEvent = await response.text();
    const payload = JSON.parse(rawEvent.match(/^data: (.+)$/m)?.[1] || "{}") as {
      message?: string;
    };
    expect(payload.message).toBe('Invalid model "haiku". Use one of: claude, codex.');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
