import { describe, expect, it } from "vitest";

import {
  buildPreviewLoadKey,
  shouldAcceptPreviewCanPlay,
  shouldResetPreviewReady,
} from "@/lib/preview-load";

describe("preview load coordination", () => {
  it("treats nonce-only refreshes as a new preview request", () => {
    expect(
      shouldResetPreviewReady({
        previousVideoUrl: "/api/files?video=1",
        nextVideoUrl: "/api/files?video=1",
        previousVideoRefreshNonce: 2,
        nextVideoRefreshNonce: 3,
      }),
    ).toBe(true);
  });

  it("produces distinct load keys for identical URLs with different nonces", () => {
    expect(buildPreviewLoadKey("/api/files?video=1", 1)).not.toBe(
      buildPreviewLoadKey("/api/files?video=1", 2),
    );
  });

  it("rejects stale canplay events from an older load request", () => {
    expect(
      shouldAcceptPreviewCanPlay({
        activeSlot: "A",
        eventSlot: "A",
        requestedLoadId: 4,
        eventLoadId: 3,
        requestedUrl: "/api/files?video=2",
        slotUrl: "/api/files?video=2",
      }),
    ).toBe(false);
  });

  it("rejects canplay from an inactive slot", () => {
    expect(
      shouldAcceptPreviewCanPlay({
        activeSlot: "A",
        eventSlot: "B",
        requestedLoadId: 5,
        eventLoadId: 5,
        requestedUrl: "/api/files?video=2",
        slotUrl: "/api/files?video=2",
      }),
    ).toBe(false);
  });

  it("accepts canplay only for the current slot, load id, and URL", () => {
    expect(
      shouldAcceptPreviewCanPlay({
        activeSlot: "A",
        eventSlot: "A",
        requestedLoadId: 5,
        eventLoadId: 5,
        requestedUrl: "/api/files?video=2",
        slotUrl: "/api/files?video=2",
      }),
    ).toBe(true);
  });
});
