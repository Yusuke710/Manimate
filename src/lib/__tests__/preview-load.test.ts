import { describe, expect, it } from "vitest";

import {
  buildPreviewAssetLoadKey,
  buildPreviewLoadKey,
  shouldAbortLingeringPreviewStream,
  shouldAcceptPreviewCanPlay,
  shouldAcceptPreviewAsyncResult,
  shouldAcceptPolledPreviewUpdate,
  shouldResetPreviewReady,
  shouldShowBrowserPreviewBadge,
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

  it("includes the preview load key when deduping preview asset requests", () => {
    expect(
      buildPreviewAssetLoadKey("2:/api/files?video=1", "/api/chapters?session_id=123"),
    ).toBe("2:/api/files?video=1:/api/chapters?session_id=123");
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

  it("rejects stale async preview results after a newer load starts", () => {
    expect(
      shouldAcceptPreviewAsyncResult({
        requestedLoadKey: "6:/api/files?video=2",
        responseLoadKey: "5:/api/files?video=1",
        aborted: false,
      }),
    ).toBe(false);
  });

  it("rejects aborted async preview results even if the load key matches", () => {
    expect(
      shouldAcceptPreviewAsyncResult({
        requestedLoadKey: "6:/api/files?video=2",
        responseLoadKey: "6:/api/files?video=2",
        aborted: true,
      }),
    ).toBe(false);
  });

  it("accepts async preview results only for the active load key", () => {
    expect(
      shouldAcceptPreviewAsyncResult({
        requestedLoadKey: "6:/api/files?video=2",
        responseLoadKey: "6:/api/files?video=2",
        aborted: false,
      }),
    ).toBe(true);
  });

  it("accepts a polled preview update after the run finishes even if the stream is still pending", () => {
    expect(
      shouldAcceptPolledPreviewUpdate({
        hasPendingStream: true,
        runStillActive: false,
      }),
    ).toBe(true);
  });

  it("keeps waiting for the stream while the run is still active", () => {
    expect(
      shouldAcceptPolledPreviewUpdate({
        hasPendingStream: true,
        runStillActive: true,
      }),
    ).toBe(false);
  });

  it("aborts a lingering stream after polling recovers the completed preview", () => {
    expect(
      shouldAbortLingeringPreviewStream({
        hasPendingStream: true,
        runStillActive: false,
        previewChanged: true,
      }),
    ).toBe(true);
  });

  it("does not abort the stream before a completed preview is available", () => {
    expect(
      shouldAbortLingeringPreviewStream({
        hasPendingStream: true,
        runStillActive: false,
        previewChanged: false,
      }),
    ).toBe(false);
  });

  it("shows the browser badge for an already-completed session", () => {
    expect(
      shouldShowBrowserPreviewBadge({
        videoUrl: "/api/files?video=1",
        isLoading: false,
        badgeAlreadyVisible: false,
      }),
    ).toBe(true);
  });

  it("hides the browser badge while a new render is still running", () => {
    expect(
      shouldShowBrowserPreviewBadge({
        videoUrl: "/api/files?video=1",
        isLoading: true,
        badgeAlreadyVisible: false,
      }),
    ).toBe(false);
  });

  it("keeps the browser badge visible during the completion handoff once shown", () => {
    expect(
      shouldShowBrowserPreviewBadge({
        videoUrl: "/api/files?video=1",
        isLoading: true,
        badgeAlreadyVisible: true,
      }),
    ).toBe(true);
  });
});
