/**
 * Chat attachments: badge labels, content-type/extension normalization for
 * uploads, and upload error-response parsing.
 */

const EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

export function getAttachmentBadgeLabel(fileName: string, contentType?: string): string {
  if (contentType?.trim().toLowerCase() === "application/pdf") {
    return "PDF";
  }

  const extension = fileName
    .match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]
    ?.replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  return extension?.slice(0, 4) || "FILE";
}

export function resolveAttachmentContentType(
  fileName: string,
  contentType?: string,
  fallback = "application/octet-stream",
): string {
  const normalizedType = contentType?.trim().toLowerCase();
  if (normalizedType) {
    return normalizedType;
  }

  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith(".png")) return "image/png";
  if (normalizedName.endsWith(".jpg") || normalizedName.endsWith(".jpeg")) return "image/jpeg";
  if (normalizedName.endsWith(".webp")) return "image/webp";
  if (normalizedName.endsWith(".gif")) return "image/gif";
  if (normalizedName.endsWith(".pdf")) return "application/pdf";
  if (normalizedName.endsWith(".mp4")) return "video/mp4";

  return fallback;
}

export function normalizeAttachmentExtension(fileName: string, contentType?: string): string {
  const extensionFromName = fileName.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
  if (extensionFromName) {
    return extensionFromName;
  }

  const normalizedType = contentType?.trim().toLowerCase() || "";
  return EXTENSION_BY_TYPE[normalizedType] || "bin";
}

function isLikelyHtml(text: string): boolean {
  return /^\s*</.test(text);
}

export async function readUploadErrorResponse(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  }

  const text = (await response.text().catch(() => "")).trim();

  if (response.status === 413 || /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(text)) {
    return "Upload request was too large.";
  }

  if (!text || isLikelyHtml(text)) {
    return fallback;
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || fallback;
}
