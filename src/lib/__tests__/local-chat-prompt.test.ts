import { describe, expect, it } from "vitest";
import {
  buildManimateRuntimeConfig,
  buildPrompt,
} from "@/lib/local/chat";
import { NONE_VOICE_ID } from "@/lib/voices";

describe("local chat prompt and runtime config", () => {
  it("keeps session config out of the Claude prompt", () => {
    const prompt = buildPrompt({
      projectDir: "/tmp/project",
      prompt: "Animate the unit circle.",
      images: [],
    });

    expect(prompt).toContain("**Project Directory**: `/tmp/project`");
    expect(prompt).toContain("Animate the unit circle.");
    expect(prompt).not.toContain("**Aspect Ratio**:");
    expect(prompt).not.toContain("**Voice ID**:");
  });

  it("writes voice and aspect ratio to manimate runtime config", () => {
    const config = buildManimateRuntimeConfig({
      aspectRatio: "9:16",
      voiceId: "voice_123",
      prompt: "Animate the limit.",
    });

    expect(config).toEqual({
      aspect_ratio: "9:16",
      voice_id: "voice_123",
      render_profile: "iterate_480",
      output_file: "video.mp4",
      tts_enabled: true,
    });
  });

  it("disables TTS in runtime config when no voice is selected", () => {
    const config = buildManimateRuntimeConfig({
      aspectRatio: "9:16",
      voiceId: NONE_VOICE_ID,
      prompt: "Animate the limit.",
    });

    expect(config.voice_id).toBeNull();
    expect(config.tts_enabled).toBe(false);
  });

  it("infers higher render profiles from the user prompt", () => {
    expect(buildManimateRuntimeConfig({
      aspectRatio: "16:9",
      voiceId: NONE_VOICE_ID,
      prompt: "render in 1080@30fps",
    }).render_profile).toBe("hq_1080_30");

    expect(buildManimateRuntimeConfig({
      aspectRatio: "16:9",
      voiceId: NONE_VOICE_ID,
      prompt: "final render in 4k",
    }).render_profile).toBe("uhd_4k_30");
  });
});
