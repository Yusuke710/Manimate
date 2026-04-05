export function normalizeCloudSyncBaseUrl(
  baseUrl: string | null | undefined,
  fallback?: string | null,
): string {
  const trimmed = baseUrl?.trim() || fallback?.trim() || "";
  const normalized = trimmed.replace(/\/+$/, "");
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "https:" && parsed.hostname.trim().toLowerCase() === "manimate.ai") {
      parsed.hostname = "www.manimate.ai";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

export function getCloudSyncDisplayHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.replace(/^www\./i, "");
  } catch {
    return baseUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}
