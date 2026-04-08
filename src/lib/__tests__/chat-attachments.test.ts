import { describe, expect, it } from "vitest";
import {
  getAttachmentBadgeLabel,
  normalizeAttachmentExtension,
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
