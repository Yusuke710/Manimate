import { describe, expect, it } from "vitest";
import {
  chooseAutomaticOpenPort,
  compareSemverVersions,
  hasVersionOrBuildMismatch,
  isManimateStatusPayload,
  parseManifestVersion,
} from "../../../scripts/manimate-tool.mjs";

describe("automatic Manimate port selection", () => {
  it("prefers the canonical port when it is free", () => {
    expect(
      chooseAutomaticOpenPort({
        preferredPort: 32179,
        scanResults: [
          { port: 32179, status: "free" },
          { port: 32180, status: "managed-healthy" },
        ],
      })
    ).toEqual({
      port: 32179,
      adjusted: false,
      reason: null,
    });
  });

  it("reuses a running Manimate when the canonical port is blocked", () => {
    expect(
      chooseAutomaticOpenPort({
        preferredPort: 32179,
        scanResults: [
          { port: 32179, status: "unmanaged" },
          { port: 32180, status: "managed-healthy" },
          { port: 32181, status: "free" },
        ],
      })
    ).toEqual({
      port: 32180,
      adjusted: true,
      reason: "existing-instance",
    });
  });

  it("moves to the next free port when the canonical port is unavailable", () => {
    expect(
      chooseAutomaticOpenPort({
        preferredPort: 32179,
        scanResults: [
          { port: 32179, status: "unmanaged" },
          { port: 32180, status: "unmanaged" },
          { port: 32181, status: "free" },
        ],
      })
    ).toEqual({
      port: 32181,
      adjusted: true,
      reason: "port-in-use",
    });
  });

  it("avoids reusing the cloud sync port when it matches the preferred port", () => {
    expect(
      chooseAutomaticOpenPort({
        preferredPort: 32179,
        reservedCloudPort: 32179,
        scanResults: [
          { port: 32179, status: "reserved-cloud" },
          { port: 32180, status: "free" },
        ],
      })
    ).toEqual({
      port: 32180,
      adjusted: true,
      reason: "cloud-port-conflict",
    });
  });
});

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

describe("compareSemverVersions", () => {
  it("orders by numeric segments", () => {
    expect(compareSemverVersions("0.1.7", "0.1.8")).toBe(-1);
    expect(compareSemverVersions("0.2.0", "0.1.99")).toBe(1);
    expect(compareSemverVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats pre-release versions as lower than the matching release", () => {
    expect(compareSemverVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareSemverVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
  });

  it("handles missing trailing segments", () => {
    expect(compareSemverVersions("1.0", "1.0.1")).toBe(-1);
    expect(compareSemverVersions("1.0.0", "1.0")).toBe(0);
  });
});

describe("parseManifestVersion", () => {
  it("extracts the release version from latest.env", () => {
    const manifest = [
      "# latest.env",
      "MANIMATE_RELEASE_VERSION=0.1.8",
      "MANIMATE_PACKAGE_URL=/releases/manimate-0.1.8.tgz",
      "",
      "MANIMATE_NODE_VERSION=22.17.1",
    ].join("\n");
    expect(parseManifestVersion(manifest)).toBe("0.1.8");
  });

  it("strips surrounding double quotes and ignores unrelated keys", () => {
    const manifest = [
      "OTHER_KEY=foo",
      'MANIMATE_RELEASE_VERSION="1.2.3"',
    ].join("\n");
    expect(parseManifestVersion(manifest)).toBe("1.2.3");
  });

  it("returns null when the version key is missing", () => {
    expect(parseManifestVersion("OTHER_KEY=foo\n")).toBeNull();
    expect(parseManifestVersion("")).toBeNull();
  });
});
