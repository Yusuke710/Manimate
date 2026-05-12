import { describe, expect, it } from "vitest";
import { buildPrompt, inferRenderProfile } from "@/lib/local/chat";
import { NONE_VOICE_ID } from "@/lib/voices";

describe("local chat prompt", () => {
  it("includes aspect ratio, voice, and render profile inline", () => {
    const prompt = buildPrompt({
      projectDir: "/tmp/project",
      prompt: "Animate the unit circle.",
      aspectRatio: "16:9",
      voiceId: "voice_123",
      renderProfile: "iterate_480",
      images: [],
    });

    expect(prompt).toContain("**Project Directory**: `/tmp/project`");
    expect(prompt).toContain("**Aspect Ratio**: 16:9");
    expect(prompt).toContain("**Voice ID**: voice_123");
    expect(prompt).toContain("**Render Profile**: iterate_480");
    expect(prompt).toContain("Animate the unit circle.");
  });

  it("omits the Voice ID line when no voice is selected", () => {
    const prompt = buildPrompt({
      projectDir: "/tmp/project",
      prompt: "Animate the limit.",
      aspectRatio: "9:16",
      voiceId: NONE_VOICE_ID,
      renderProfile: "iterate_480",
      images: [],
    });

    expect(prompt).toContain("**Aspect Ratio**: 9:16");
    expect(prompt).not.toContain("**Voice ID**");
  });

  it("infers higher render profiles from the user prompt", () => {
    expect(inferRenderProfile("render in 1080@30fps")).toBe("hq_1080_30");
    expect(inferRenderProfile("final render in 4k")).toBe("uhd_4k_30");
    expect(inferRenderProfile("animate the unit circle")).toBe("iterate_480");
  });
});
