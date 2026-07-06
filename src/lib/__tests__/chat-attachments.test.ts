import { describe, expect, it } from "vitest";
import {
  getAttachmentBadgeLabel,
  normalizeAttachmentExtension,
  readUploadErrorResponse,
  resolveAttachmentContentType,
} from "@/lib/chat-attachments";

describe("getAttachmentBadgeLabel", () => {
  it("shows generic file extensions for non-image attachments", () => {
    expect(getAttachmentBadgeLabel("deck.pptx", "application/vnd.ms-powerpoint")).toBe("PPTX");
  });

  it("falls back to FILE when there is no usable extension", () => {
    expect(getAttachmentBadgeLabel("README", "")).toBe("FILE");
  });
});

describe("resolveAttachmentContentType", () => {
  it("keeps the provided MIME type when present", () => {
    expect(resolveAttachmentContentType("notes.txt", "text/plain")).toBe("text/plain");
  });

  it("infers common types from the file name when the browser omits MIME", () => {
    expect(resolveAttachmentContentType("spec.pdf", "")).toBe("application/pdf");
  });

  it("falls back to octet-stream for unknown file names", () => {
    expect(resolveAttachmentContentType("archive", "")).toBe("application/octet-stream");
  });
});

describe("normalizeAttachmentExtension", () => {
  it("prefers the original file extension", () => {
    expect(normalizeAttachmentExtension("archive.tar.gz", "application/gzip")).toBe("gz");
  });

  it("maps known MIME types when the name has no extension", () => {
    expect(normalizeAttachmentExtension("scan", "application/pdf")).toBe("pdf");
  });

  it("falls back to bin for unknown types", () => {
    expect(normalizeAttachmentExtension("blob", "")).toBe("bin");
  });
});

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
