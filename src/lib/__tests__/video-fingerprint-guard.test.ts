import { describe, it, expect, vi } from "vitest";
import { getProjectPath } from "@/lib/sandbox-utils";

type SandboxLike = {
  commands: {
    run: (command: string) => Promise<{ stdout?: string | null }>;
  };
};

type VideoSnapshot = {
  path: string;
  fingerprint: string | null;
};

const VIDEO_STAT_FAILED_SENTINEL = "__STAT_FAILED__";

/**
 * Mirrors src/app/api/chat/route.ts private helper.
 * Returns null if video.mp4 is absent, otherwise path + fingerprint.
 */
async function getVideoSnapshot(
  sandbox: SandboxLike,
  sandboxId: string
): Promise<VideoSnapshot | null> {
  const videoPath = `${getProjectPath(sandboxId)}/video.mp4`;
  try {
    const result = await sandbox.commands.run(
      `if [ -f "${videoPath}" ]; then stat -c '%Y %s' "${videoPath}" 2>/dev/null || echo "${VIDEO_STAT_FAILED_SENTINEL}"; fi`
    );
    const output = result.stdout?.trim();
    if (!output) {
      return null;
    }
    return {
      path: videoPath,
      fingerprint: output === VIDEO_STAT_FAILED_SENTINEL ? null : output,
    };
  } catch {
    return null;
  }
}

function isNewVideoRender(
  preRunFingerprint: string | null,
  postRunVideo: VideoSnapshot | null
): boolean {
  if (!postRunVideo) return false;
  if (postRunVideo.fingerprint === null) return true;
  return postRunVideo.fingerprint !== preRunFingerprint;
}

function shouldTriggerVoiceover(
  videoIsNew: boolean,
  sessionId: string | null,
  hasElevenLabsApiKey: boolean
): boolean {
  return Boolean(videoIsNew && sessionId && hasElevenLabsApiKey);
}

describe("getVideoSnapshot()", () => {
  it("returns path + trimmed mtime+size fingerprint from stat output", async () => {
    const sandboxId = "sandbox-abc-123";
    const run = vi.fn().mockResolvedValue({ stdout: "1700000000 4096\n" });
    const sandbox: SandboxLike = { commands: { run } };

    const snapshot = await getVideoSnapshot(sandbox, sandboxId);

    expect(snapshot).toEqual({
      path: `${getProjectPath(sandboxId)}/video.mp4`,
      fingerprint: "1700000000 4096",
    });
    expect(run).toHaveBeenCalledWith(
      `if [ -f "${getProjectPath(sandboxId)}/video.mp4" ]; then stat -c '%Y %s' "${getProjectPath(sandboxId)}/video.mp4" 2>/dev/null || echo "${VIDEO_STAT_FAILED_SENTINEL}"; fi`
    );
  });

  it("returns fingerprint null when stat fails on an existing video", async () => {
    const sandboxId = "sandbox-stat-fail";
    const sandbox: SandboxLike = {
      commands: { run: vi.fn().mockResolvedValue({ stdout: `${VIDEO_STAT_FAILED_SENTINEL}\n` }) },
    };

    const snapshot = await getVideoSnapshot(sandbox, sandboxId);

    expect(snapshot).toEqual({
      path: `${getProjectPath(sandboxId)}/video.mp4`,
      fingerprint: null,
    });
  });

  it("returns null when video.mp4 is absent", async () => {
    const sandbox: SandboxLike = {
      commands: { run: vi.fn().mockResolvedValue({ stdout: "\n" }) },
    };

    const snapshot = await getVideoSnapshot(sandbox, "sandbox-empty");

    expect(snapshot).toBeNull();
  });

  it("returns null when command throws", async () => {
    const sandbox: SandboxLike = {
      commands: { run: vi.fn().mockRejectedValue(new Error("stat failed")) },
    };

    const snapshot = await getVideoSnapshot(sandbox, "sandbox-error");

    expect(snapshot).toBeNull();
  });
});

describe("isNewVideoRender()", () => {
  it("returns false when post-run video is missing", () => {
    expect(isNewVideoRender("1700000000 8192", null)).toBe(false);
  });

  it("returns false when fingerprint is unchanged", () => {
    expect(
      isNewVideoRender("1700000000 8192", {
        path: "/tmp/video.mp4",
        fingerprint: "1700000000 8192",
      })
    ).toBe(false);
  });

  it("returns true when fingerprint changed", () => {
    expect(
      isNewVideoRender("1700000000 8192", {
        path: "/tmp/video.mp4",
        fingerprint: "1700000060 12288",
      })
    ).toBe(true);
  });

  it("returns true when post-run stat failed on an existing video", () => {
    expect(
      isNewVideoRender(null, {
        path: "/tmp/video.mp4",
        fingerprint: null,
      })
    ).toBe(true);
  });
});

describe("voiceover trigger gate", () => {
  it("requires new video + session id + ELEVENLABS key", () => {
    expect(shouldTriggerVoiceover(true, "session-1", true)).toBe(true);
    expect(shouldTriggerVoiceover(false, "session-1", true)).toBe(false);
    expect(shouldTriggerVoiceover(true, null, true)).toBe(false);
    expect(shouldTriggerVoiceover(true, "session-1", false)).toBe(false);
  });
});
