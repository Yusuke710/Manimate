import { describe, expect, it } from "vitest";
import { parseUrlLaunchIntent } from "@/lib/url-launch-intent";
import { DEFAULT_VOICE_ID } from "@/lib/voices";

describe("parseUrlLaunchIntent", () => {
  it("parses prompt with optional launch settings", () => {
    const intent = parseUrlLaunchIntent(
      `prompt=Animate%20vectors&send=1&model=haiku&voice_id=${DEFAULT_VOICE_ID}&aspect_ratio=9%3A16`
    );

    expect(intent).toEqual({
      prompt: "Animate vectors",
      autoSend: true,
      model: "haiku",
      voiceId: DEFAULT_VOICE_ID,
      aspectRatio: "9:16",
    });
  });

  it("supports q alias and falsey send by default", () => {
    const intent = parseUrlLaunchIntent("q=Explain%20Taylor%20series");
    expect(intent).toEqual({
      prompt: "Explain Taylor series",
      autoSend: false,
    });
  });

  it("drops invalid optional params", () => {
    const intent = parseUrlLaunchIntent(
      "prompt=Test&send=true&model=invalid&voice_id=bad&aspect_ratio=5:4"
    );
    expect(intent).toEqual({
      prompt: "Test",
      autoSend: true,
    });
  });

  it("returns null when prompt is missing or empty", () => {
    expect(parseUrlLaunchIntent("send=1")).toBeNull();
    expect(parseUrlLaunchIntent("prompt=%20%20%20")).toBeNull();
    expect(parseUrlLaunchIntent("")).toBeNull();
  });
});
