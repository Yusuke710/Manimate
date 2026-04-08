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
