import { describe, expect, it } from "vitest";
import {
  normalizeBrandKitAnalysisResult,
  normalizeBrandKitImageMediaType,
} from "@/lib/brand-kit-analysis";

describe("normalizeBrandKitImageMediaType", () => {
  it("accepts supported image types and normalizes jpg", () => {
    expect(normalizeBrandKitImageMediaType("image/png")).toBe("image/png");
    expect(normalizeBrandKitImageMediaType("image/jpg")).toBe("image/jpeg");
    expect(normalizeBrandKitImageMediaType(" IMAGE/WEBP ")).toBe("image/webp");
  });

  it("rejects unsupported image types", () => {
    expect(normalizeBrandKitImageMediaType("image/svg+xml")).toBeNull();
    expect(normalizeBrandKitImageMediaType("text/plain")).toBeNull();
    expect(normalizeBrandKitImageMediaType("")).toBeNull();
  });
});

describe("normalizeBrandKitAnalysisResult", () => {
  it("normalizes, deduplicates, and limits colors and fonts", () => {
    expect(
      normalizeBrandKitAnalysisResult({
        colors: {
          primary: ["#ABC", "abc", "#123456", "xyz", "#fedcba"],
          accent: ["#fff", "#FFF", "#111111", "#222222"],
          background: ["#eeeeee", "#DDDDDD", "#cccccc"],
        },
        fonts: [" inter ", "ROBOTO MONO", "Unknown Font", "Inter"],
      })
    ).toEqual({
      colors: {
        primary: ["#abc", "#123456", "#fedcba"],
        accent: ["#fff", "#111111"],
        background: ["#eeeeee", "#dddddd"],
      },
      fonts: ["Inter", "Roboto Mono"],
    });
  });

  it("returns empty arrays for invalid shapes", () => {
    expect(normalizeBrandKitAnalysisResult(null)).toEqual({
      colors: { primary: [], accent: [], background: [] },
      fonts: [],
    });

    expect(
      normalizeBrandKitAnalysisResult({
        colors: "nope",
        fonts: [123, null, "Not A Supported Font"],
      })
    ).toEqual({
      colors: { primary: [], accent: [], background: [] },
      fonts: [],
    });
  });
});
