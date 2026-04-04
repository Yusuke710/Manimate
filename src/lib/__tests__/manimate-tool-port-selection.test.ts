import { describe, expect, it } from "vitest";
import { chooseAutomaticOpenPort } from "../../../scripts/manimate-tool.mjs";

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
