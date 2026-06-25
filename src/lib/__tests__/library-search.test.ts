import { describe, expect, it } from "vitest";

import { matchesLibrarySearch } from "@/lib/library-search";

describe("matchesLibrarySearch", () => {
  const record = {
    title: "Transformer explainer",
    plan_content: "Introduce attention weights with highlighted tokens.",
    script_content: "class AttentionScene(Scene): pass",
  };

  it("matches title, plan, and script content", () => {
    expect(matchesLibrarySearch(record, "transformer")).toBe(true);
    expect(matchesLibrarySearch(record, "weights")).toBe(true);
    expect(matchesLibrarySearch(record, "AttentionScene")).toBe(true);
  });

  it("matches likely misspellings in longer tokens", () => {
    expect(matchesLibrarySearch(record, "attenton")).toBe(true);
    expect(matchesLibrarySearch(record, "atention")).toBe(true);
  });

  it("requires every query token to match", () => {
    expect(matchesLibrarySearch(record, "attention tokens")).toBe(true);
    expect(matchesLibrarySearch(record, "attention planets")).toBe(false);
  });
});
