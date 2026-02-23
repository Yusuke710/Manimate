import { describe, expect, it } from "vitest";
import { getProjectPath } from "@/lib/sandbox-utils";

describe("sandbox utils", () => {
  it("builds a project path from a sandbox id", () => {
    expect(getProjectPath("sandbox-abc-123")).toBe("/home/user/sandbox-abc-123");
  });

  it("sanitizes unsafe sandbox id characters in project paths", () => {
    expect(getProjectPath("sandbox/../../abc")).toBe("/home/user/sandbox_______abc");
  });
});
