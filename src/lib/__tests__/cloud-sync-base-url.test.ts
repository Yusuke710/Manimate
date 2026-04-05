import { describe, expect, it } from "vitest";

import {
  getCloudSyncDisplayHost,
  normalizeCloudSyncBaseUrl,
} from "@/lib/local/cloud-sync-base-url";

describe("normalizeCloudSyncBaseUrl", () => {
  it("canonicalizes the hosted apex domain to www for authenticated sync", () => {
    expect(normalizeCloudSyncBaseUrl("https://manimate.ai")).toBe("https://www.manimate.ai");
    expect(normalizeCloudSyncBaseUrl("https://manimate.ai/")).toBe("https://www.manimate.ai");
    expect(normalizeCloudSyncBaseUrl("https://www.manimate.ai")).toBe("https://www.manimate.ai");
  });

  it("leaves non-hosted and loopback targets unchanged", () => {
    expect(normalizeCloudSyncBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeCloudSyncBaseUrl("https://example.com/base/")).toBe("https://example.com/base");
  });
});

describe("getCloudSyncDisplayHost", () => {
  it("strips the www prefix from the displayed host label", () => {
    expect(getCloudSyncDisplayHost("https://www.manimate.ai")).toBe("manimate.ai");
    expect(getCloudSyncDisplayHost("https://manimate.ai")).toBe("manimate.ai");
  });
});
