import { describe, expect, it } from "vitest";

import {
  CLOUD_SYNC_AUTH_RECONNECT_MESSAGE,
  formatCloudSyncFailureMessage,
  isCloudSyncAuthorizationError,
  shouldRetryCloudSyncSession,
} from "@/lib/local/cloud-sync-policy";

describe("cloud sync policy", () => {
  it("recognizes authorization failures from hosted sync", () => {
    expect(isCloudSyncAuthorizationError("Unauthorized")).toBe(true);
    expect(
      isCloudSyncAuthorizationError(
        "Cloud sync is no longer authorized. Reopen Manimate to reconnect.",
      ),
    ).toBe(true);
  });

  it("keeps non-auth failures as-is", () => {
    expect(isCloudSyncAuthorizationError("HTTP 500")).toBe(false);
    expect(formatCloudSyncFailureMessage("HTTP 500")).toBe("HTTP 500");
  });

  it("normalizes auth failures to a non-looping reconnect message", () => {
    expect(formatCloudSyncFailureMessage("Unauthorized")).toBe(
      CLOUD_SYNC_AUTH_RECONNECT_MESSAGE,
    );
  });

  it("does not auto-retry failed sessions blocked by auth errors", () => {
    expect(
      shouldRetryCloudSyncSession({
        cloudSyncStatus: "failed",
        cloudLastError:
          "Cloud sync is no longer authorized. Reopen Manimate to reconnect.",
      }),
    ).toBe(false);
  });

  it("still retries normal pending and failed sync candidates", () => {
    expect(
      shouldRetryCloudSyncSession({
        cloudSyncStatus: "pending",
        cloudLastError: null,
      }),
    ).toBe(true);
    expect(
      shouldRetryCloudSyncSession({
        cloudSyncStatus: "failed",
        cloudLastError: "HTTP 500",
      }),
    ).toBe(true);
  });
});
