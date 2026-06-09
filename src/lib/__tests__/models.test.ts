import { describe, expect, it } from "vitest";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  MODEL_REGISTRY,
  getModelDisplayLabel,
  isRegisteredModelId,
} from "@/lib/models";

describe("local model identity", () => {
  it("uses Claude as the inherited default model", () => {
    expect(Object.hasOwn(MODEL_REGISTRY, DEFAULT_MODEL)).toBe(true);
    expect(DEFAULT_MODEL).toBe("claude");
  });

  it("exposes only Claude as the current logical model", () => {
    const ids = new Set(AVAILABLE_MODELS.map((model) => model.id));
    expect(ids.has("claude")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("shows the logical model label", () => {
    expect(getModelDisplayLabel("claude")).toBe("Claude");
  });

  it("validates logical model IDs", () => {
    expect(isRegisteredModelId("claude")).toBe(true);
    expect(isRegisteredModelId("opus")).toBe(false);
    expect(isRegisteredModelId("sonnet")).toBe(false);
    expect(isRegisteredModelId("haiku")).toBe(false);
  });
});
