import { describe, expect, it } from "vitest";
import { extractScriptTitle } from "./script-title";

describe("extractScriptTitle", () => {
  it("reads the header with Unicode, BOM, and Windows line endings", () => {
    expect(extractScriptTitle("\uFEFF# Title:  Why E = mc² Matters  \r\nfrom manim import *"))
      .toBe("Why E = mc² Matters");
  });

  it.each([null, "", "# Title:", "# Title:   \nfrom manim import *", "from manim import *"])(
    "returns no replacement for a missing or empty header: %s",
    (script) => expect(extractScriptTitle(script)).toBeNull(),
  );

  it("does not mistake comments inside Python strings for the title header", () => {
    expect(extractScriptTitle('description = """\n# Title: Not the video title\n"""'))
      .toBeNull();
  });
});
