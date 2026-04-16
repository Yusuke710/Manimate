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
  it("normalizes colors and explicit font roles", () => {
    expect(
      normalizeBrandKitAnalysisResult({
        colors: {
          primary: ["#ABC", "abc", "#123456", "xyz", "#fedcba"],
          accent: ["#fff", "#FFF", "#111111", "#222222"],
          background: ["#eeeeee", "#DDDDDD", "#cccccc"],
        },
        fonts: {
          heading: " inter ",
          body: "ROBOTO MONO",
          accent: "Unknown Font",
        },
      })
    ).toEqual({
      colors: {
        primary: ["#abc", "#123456", "#fedcba"],
        accent: ["#fff", "#111111"],
        background: ["#eeeeee", "#dddddd"],
      },
      fonts: {
        heading: "Inter",
        body: "Roboto Mono",
        accent: null,
      },
    });
  });

  it("supports the legacy font array shape", () => {
    expect(
      normalizeBrandKitAnalysisResult({
        colors: {},
        fonts: ["Inter", "Nunito", "Not A Real Font"],
      })
    ).toEqual({
      colors: { primary: [], accent: [], background: [] },
      fonts: {
        heading: "Inter",
        body: "Nunito",
        accent: null,
      },
    });
  });

  it("returns empty values for invalid shapes", () => {
    expect(normalizeBrandKitAnalysisResult(null)).toEqual({
      colors: { primary: [], accent: [], background: [] },
      fonts: { heading: null, body: null, accent: null },
    });

    expect(
      normalizeBrandKitAnalysisResult({
        colors: "nope",
        fonts: [123, null, "Not A Supported Font"],
      })
    ).toEqual({
      colors: { primary: [], accent: [], background: [] },
      fonts: { heading: null, body: null, accent: null },
    });
  });
});
