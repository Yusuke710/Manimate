import { describe, expect, it } from "vitest";
import { shouldApplyArtifactSnapshot } from "@/app/HomeClient";

describe("artifact reconciliation", () => {
  it("applies changed SQLite snapshots over stale UI content", () => {
    expect(shouldApplyArtifactSnapshot('print("reverted")', 'print("v1")')).toBe(true);
  });

  it("applies cleared artifact snapshots", () => {
    expect(shouldApplyArtifactSnapshot(null, 'print("v1")')).toBe(true);
  });

  it("skips unchanged snapshots", () => {
    expect(shouldApplyArtifactSnapshot('print("v1")', 'print("v1")')).toBe(false);
  });
});
