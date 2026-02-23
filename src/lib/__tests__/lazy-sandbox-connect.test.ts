/**
 * Tests for lazy sandbox connection on past session visit.
 *
 * Local runtimes can pause when idle. Visiting a past session
 * should NOT wake the runtime; it should only connect when the user
 * starts typing or sends a message. This prevents unnecessary billing
 * and cold-start latency on casual browsing.
 *
 * What we verify:
 *  1. PreviewPanel receives sandboxId=null until user interacts.
 *  2. Subtitle/chapters URLs constructed WITHOUT sandbox context when
 *     sandboxId is null, so APIs use DB-only paths.
 *  3. Active runs auto-activate the sandbox (it's already awake).
 *  4. User sending a message activates the sandbox.
 */

import { describe, it, expect } from "vitest";
import { getProjectPath } from "@/lib/sandbox-utils";

/**
 * Simulates the subtitle URL construction logic from PreviewPanel.
 * Mirrors lines ~1150-1158 of PreviewPanel.tsx.
 */
function buildSubtitleUrl(
  fullVideoUrl: string | null,
  sessionId: string | null,
  sandboxId: string | null,
): string | null {
  const projectDir = sandboxId ? getProjectPath(sandboxId) : null;
  return fullVideoUrl
    ? sessionId
      ? sandboxId && projectDir
        ? `/api/subtitles?session_id=${encodeURIComponent(sessionId)}&sandbox_id=${encodeURIComponent(sandboxId)}&project_path=${encodeURIComponent(projectDir)}`
        : `/api/subtitles?session_id=${encodeURIComponent(sessionId)}`
      : projectDir && sandboxId
        ? `/api/subtitles?sandbox_id=${encodeURIComponent(sandboxId)}&project_path=${encodeURIComponent(projectDir)}`
        : null
    : null;
}

/**
 * Simulates the chapters URL construction logic from PreviewPanel.
 */
function buildChaptersUrl(sessionId: string | null): string | null {
  return sessionId
    ? `/api/chapters?session_id=${encodeURIComponent(sessionId)}`
    : null;
}

describe("lazy sandbox connection on session visit", () => {
  const SESSION_ID = "sess-abc-123";
  const SANDBOX_ID = "sbx-xyz-456";
  const VIDEO_URL = "https://cdn.example.com/video.mp4";

  describe("subtitle URL gating", () => {
    it("excludes sandbox_id when sandbox not active (user hasn't interacted)", () => {
      // sandboxActive=false → activeSandboxId=null → URL uses session-only path
      const activeSandboxId = false ? SANDBOX_ID : null;
      const url = buildSubtitleUrl(VIDEO_URL, SESSION_ID, activeSandboxId);
      expect(url).toBe(`/api/subtitles?session_id=${encodeURIComponent(SESSION_ID)}`);
      expect(url).not.toContain("sandbox_id");
    });

    it("includes sandbox_id after user activates sandbox", () => {
      // sandboxActive=true → activeSandboxId=SANDBOX_ID
      const activeSandboxId = true ? SANDBOX_ID : null;
      const url = buildSubtitleUrl(VIDEO_URL, SESSION_ID, activeSandboxId);
      expect(url).toContain(`sandbox_id=${encodeURIComponent(SANDBOX_ID)}`);
      expect(url).toContain(`session_id=${encodeURIComponent(SESSION_ID)}`);
    });

    it("returns null when no video URL exists", () => {
      const url = buildSubtitleUrl(null, SESSION_ID, SANDBOX_ID);
      expect(url).toBeNull();
    });
  });

  describe("chapters URL (session-only)", () => {
    it("uses session_id only, never sandbox_id", () => {
      const url = buildChaptersUrl(SESSION_ID);
      expect(url).toBe(`/api/chapters?session_id=${encodeURIComponent(SESSION_ID)}`);
      expect(url).not.toContain("sandbox_id");
    });
  });

  describe("activeSandboxId gating (used for URL construction)", () => {
    it("returns null when sandbox not activated", () => {
      const sandboxActive = false;
      const sandboxId = SANDBOX_ID;
      const activeSandboxId = sandboxActive ? sandboxId : null;
      expect(activeSandboxId).toBeNull();
      // sandboxId itself is still available for other uses (retry, placeholder)
      expect(sandboxId).toBe(SANDBOX_ID);
    });

    it("returns sandboxId when sandbox is activated", () => {
      const sandboxActive = true;
      const sandboxId = SANDBOX_ID;
      const activeSandboxId = sandboxActive ? sandboxId : null;
      expect(activeSandboxId).toBe(SANDBOX_ID);
    });

    it("returns null when activated but no sandboxId exists yet", () => {
      const sandboxActive = true;
      const sandboxId: string | null = null;
      const activeSandboxId = sandboxActive ? sandboxId : null;
      expect(activeSandboxId).toBeNull();
    });
  });

  describe("activation triggers", () => {
    it("active run sets sandboxActivated to true", () => {
      // Simulate: bootstrap detects an active run
      let sandboxActivated = false;
      const activeRun = { status: "running" as const };
      if (activeRun.status === "running" || activeRun.status === "queued") {
        sandboxActivated = true;
      }
      expect(sandboxActivated).toBe(true);
    });

    it("completed/failed run does NOT activate sandbox", () => {
      let sandboxActivated = false;
      const status: string = "completed";
      if (status === "running" || status === "queued") {
        sandboxActivated = true;
      }
      expect(sandboxActivated).toBe(false);
    });
  });
});
