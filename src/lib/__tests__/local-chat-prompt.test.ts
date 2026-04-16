import { describe, expect, it } from "vitest";
import {
  buildPrompt,
} from "@/lib/local/chat";
import { NONE_VOICE_ID } from "@/lib/voices";

describe("local chat session config prompt gating", () => {
  it("includes aspect ratio and voice on the first turn", () => {
    const prompt = buildPrompt({
      projectDir: "/tmp/project",
      prompt: "Animate the unit circle.",
      aspectRatio: "16:9",
      voiceId: "voice_123",
      includeSessionConfig: true,
      images: [],
    });

    expect(prompt).toContain("**Aspect Ratio**: 16:9");
    expect(prompt).toContain("**Voice ID**: voice_123");
    expect(prompt).toContain("Animate the unit circle.");
  });

  it("omits aspect ratio and voice on follow-up turns", () => {
    const prompt = buildPrompt({
      projectDir: "/tmp/project",
      prompt: "Now make it faster.",
      aspectRatio: "16:9",
      voiceId: "voice_123",
      includeSessionConfig: false,
      images: [],
    });

    expect(prompt).not.toContain("**Aspect Ratio**:");
    expect(prompt).not.toContain("**Voice ID**:");
    expect(prompt).toContain("Now make it faster.");
  });

  it("keeps voice omitted when no voice is selected", () => {
    const prompt = buildPrompt({
      projectDir: "/tmp/project",
      prompt: "Animate the limit.",
      aspectRatio: "9:16",
      voiceId: NONE_VOICE_ID,
      includeSessionConfig: true,
      images: [],
    });

    expect(prompt).toContain("**Aspect Ratio**: 9:16");
    expect(prompt).not.toContain("**Voice ID**:");
  });
});
