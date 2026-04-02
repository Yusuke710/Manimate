export const CLOUD_SYNC_AUTH_RECONNECT_MESSAGE =
  "Cloud sync authorization was rejected. Local work is still saved here. Reconnect only if autosync should resume.";

export function isCloudSyncAuthorizationError(
  message: string | null | undefined,
): boolean {
  const normalized = message?.trim().toLowerCase() || "";
  if (!normalized) return false;

  return (
    normalized.includes("unauthorized") ||
    normalized.includes("not authorized") ||
    normalized.includes("no longer authorized") ||
    normalized.includes("authorization was rejected")
  );
}

export function formatCloudSyncFailureMessage(
  message: string | null | undefined,
): string {
  if (isCloudSyncAuthorizationError(message)) {
    return CLOUD_SYNC_AUTH_RECONNECT_MESSAGE;
  }

  return message?.trim() || "Cloud sync failed";
}

export function shouldRetryCloudSyncSession(params: {
  cloudSyncStatus: string | null | undefined;
  cloudLastError: string | null | undefined;
}): boolean {
  if (
    params.cloudSyncStatus !== "idle" &&
    params.cloudSyncStatus !== "pending" &&
    params.cloudSyncStatus !== "failed"
  ) {
    return false;
  }

  if (
    params.cloudSyncStatus === "failed" &&
    isCloudSyncAuthorizationError(params.cloudLastError)
  ) {
    return false;
  }

  return true;
}
