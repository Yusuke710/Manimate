import { describe, expect, it } from "vitest";
import packageMetadata from "../../../package.json";
import { GET } from "@/app/api/cloud-sync/status/route";

describe("/api/cloud-sync/status", () => {
  it("includes the current app version in the local status response", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.headers.get("x-manimate-studio")).toBe("local");
    expect(data.version).toBe(packageMetadata.version);
    expect(typeof data.status).toBe("string");
  });
});
