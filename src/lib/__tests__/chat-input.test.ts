import { describe, expect, it } from "vitest";

import { appendFrameInstructionToPrompt } from "@/components/ChatInput";

describe("appendFrameInstructionToPrompt", () => {
  it("uses a comma between a chapter capture prefix and red-stroke annotation text", () => {
    expect(
      appendFrameInstructionToPrompt(
        "[0:33] Scene4 Reasoning Explosion: ",
        "user annotation in red stroke:",
      ),
    ).toBe("[0:33] Scene4 Reasoning Explosion, user annotation in red stroke:");
  });

  it("preserves the annotation note separator after the red-stroke label", () => {
    expect(
      appendFrameInstructionToPrompt(
        "[0:33] Scene4 Reasoning Explosion: ",
        "user annotation in red stroke: tighten this arc",
      ),
    ).toBe("[0:33] Scene4 Reasoning Explosion, user annotation in red stroke: tighten this arc");
  });

  it("keeps the colon for non-annotation text", () => {
    expect(
      appendFrameInstructionToPrompt(
        "[0:33] Scene4 Reasoning Explosion: ",
        "make the equation larger",
      ),
    ).toBe("[0:33] Scene4 Reasoning Explosion: make the equation larger");
  });
});
