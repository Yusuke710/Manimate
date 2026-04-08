import { describe, expect, it } from "vitest";
import { readUploadErrorResponse } from "@/lib/chat-upload-response";

describe("readUploadErrorResponse", () => {
  it("returns JSON error payloads", async () => {
    const response = new Response(JSON.stringify({ error: "Upload denied" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readUploadErrorResponse(response, "Upload failed")).resolves.toBe("Upload denied");
  });

  it("returns the first line from plain-text failures", async () => {
    const response = new Response("Gateway timeout\ntrace-id=123", {
      status: 504,
      headers: { "Content-Type": "text/plain" },
    });

    await expect(readUploadErrorResponse(response, "Upload failed")).resolves.toBe("Gateway timeout");
  });

  it("normalizes oversized upload failures", async () => {
    const response = new Response("Request Entity Too Large", {
      status: 413,
      headers: { "Content-Type": "text/plain" },
    });

    await expect(readUploadErrorResponse(response, "Upload failed")).resolves.toBe("Upload request was too large.");
  });
});
