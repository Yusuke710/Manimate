import { describe, expect, it } from "vitest";
import { isManimateStatusPayload } from "../../../scripts/manimate-tool.mjs";

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
});
