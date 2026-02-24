import { describe, expect, it } from "vitest";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  MODEL_REGISTRY,
  getModelDisplayLabel,
  isRegisteredModelId,
} from "@/lib/models";

describe("local model registry", () => {
  it("keeps a valid default model", () => {
    expect(Object.hasOwn(MODEL_REGISTRY, DEFAULT_MODEL)).toBe(true);
  });

  it("exposes additional Claude Code models in the selector", () => {
    const ids = new Set(AVAILABLE_MODELS.map((model) => model.id));
    expect(ids.has("opus")).toBe(true);
    expect(ids.has("sonnet")).toBe(true);
    expect(ids.has("haiku")).toBe(true);
    expect(ids.size).toBe(3);
  });

  it("shows full version labels and concise descriptions", () => {
    expect(getModelDisplayLabel("opus")).toBe("Opus 4.6");
    expect(getModelDisplayLabel("sonnet")).toBe("Sonnet 4.5");
    expect(getModelDisplayLabel("haiku")).toBe("Haiku 4.5");

    expect(MODEL_REGISTRY.opus.description).toBe("Most capable for complex work");
    expect(MODEL_REGISTRY.sonnet.description).toBe("Best for everyday tasks");
    expect(MODEL_REGISTRY.haiku.description).toBe("Fastest for quick answers");
  });

  it("exposes a shared model ID validator", () => {
    expect(isRegisteredModelId("opus")).toBe(true);
    expect(isRegisteredModelId("sonnet")).toBe(true);
    expect(isRegisteredModelId("haiku")).toBe(true);
    expect(isRegisteredModelId("claude-opus-4-6")).toBe(false);
  });
});
