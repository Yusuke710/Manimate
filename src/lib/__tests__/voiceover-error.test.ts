import { describe, expect, it } from "vitest";

import { parseVoiceoverFailure } from "../voiceover-error";

describe("parseVoiceoverFailure", () => {
  it("returns retryable generic error when message is missing", () => {
    const parsed = parseVoiceoverFailure(null);
    expect(parsed.kind).toBe("generic");
    expect(parsed.retryable).toBe(true);
    expect(parsed.message).toContain("Audio generation failed");
  });

  it("detects provider quota_exceeded JSON payload", () => {
    const parsed = parseVoiceoverFailure(
      JSON.stringify({
        detail: {
          status: "quota_exceeded",
          message: "This request exceeds your quota",
        },
      })
    );

    expect(parsed.kind).toBe("quota_exceeded");
    expect(parsed.retryable).toBe(true);
    expect(parsed.message).toContain("exceeds your quota");
  });

  it("detects wrapped API error strings containing quota_exceeded", () => {
    const parsed = parseVoiceoverFailure(
      "ElevenLabs API error: 401 - {\"detail\":{\"status\":\"quota_exceeded\",\"message\":\"This request exceeds your quota\"}}"
    );

    expect(parsed.kind).toBe("quota_exceeded");
    expect(parsed.retryable).toBe(true);
  });

  it("detects normalized server quota message", () => {
    const parsed = parseVoiceoverFailure(
      "ElevenLabs quota exceeded. Check your ElevenLabs plan/quota, then retry."
    );

    expect(parsed.kind).toBe("quota_exceeded");
    expect(parsed.retryable).toBe(true);
  });

  it("passes through non-quota errors as retryable", () => {
    const parsed = parseVoiceoverFailure("Failed to mux video: ffmpeg exited with code 1");

    expect(parsed.kind).toBe("generic");
    expect(parsed.retryable).toBe(true);
    expect(parsed.message).toContain("Failed to mux video");
  });
});
