import { describe, expect, it } from "vitest";
import {
  hasVersionOrBuildMismatch,
  isManimateStatusPayload,
} from "../../../scripts/manimate-tool.mjs";

describe("manimate CLI status probe", () => {
  it("accepts the current local cloud status payload when marked by the local header", () => {
    expect(
      isManimateStatusPayload(
        {
          status: "disconnected",
          base_url: "https://manimate.ai",
          version: "0.1.3",
        },
        { markedLocal: true }
      )
    ).toBe(true);
  });

  it("accepts legacy status payloads without the local header", () => {
    expect(
      isManimateStatusPayload({
        status: "ready",
        connected: true,
      })
    ).toBe(true);
  });

  it("rejects unrelated JSON responses", () => {
    expect(
      isManimateStatusPayload({
        ok: true,
      })
    ).toBe(false);
  });

  it("treats a changed build id as a mismatch even when the version is unchanged", () => {
    expect(
      hasVersionOrBuildMismatch({
        installedVersion: "0.1.4",
        runningVersion: "0.1.4",
        installedBuildId: "build-new",
        runningBuildId: "build-old",
      })
    ).toBe(true);
  });

  it("does not flag a mismatch when version and build id both match", () => {
    expect(
      hasVersionOrBuildMismatch({
        installedVersion: "0.1.4",
        runningVersion: "0.1.4",
        installedBuildId: "build-same",
        runningBuildId: "build-same",
      })
    ).toBe(false);
  });
});
