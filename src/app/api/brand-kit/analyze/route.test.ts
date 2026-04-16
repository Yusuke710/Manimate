import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();

  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  }
});

async function buildImageDataUrl(filename: string): Promise<string> {
  const imagePath = path.join(process.cwd(), filename);
  const bytes = await readFile(imagePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

describe("POST /api/brand-kit/analyze", () => {
  it("returns normalized brand kit data for the local polarbear screenshot", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            name: "extract_brand_kit",
            input: {
              colors: {
                primary: ["#51AC52", "#C154CA", "#F5F2E9"],
                accent: ["#f4a340", "#c154ca", "#ffffff"],
                background: ["#ffffff", "#f8f8f8", "#ececec"],
              },
              fonts: ["Inter", "Nunito", "Not A Real Font"],
            },
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("http://localhost/api/brand-kit/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: await buildImageDataUrl("polarbear_test.png"),
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      colors: {
        primary: ["#51ac52", "#c154ca", "#f5f2e9"],
        accent: ["#f4a340", "#c154ca"],
        background: ["#ffffff", "#f8f8f8"],
      },
      fonts: ["Inter", "Nunito"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{
        content: Array<{
          type: string;
          source?: { media_type?: string; data?: string };
          text?: string;
        }>;
      }>;
      tools: Array<{ name: string }>;
    };

    expect(body.tools[0]?.name).toBe("extract_brand_kit");
    expect(body.messages[0]?.content[0]?.source?.media_type).toBe("image/png");
    expect(body.messages[0]?.content[0]?.source?.data?.length).toBeGreaterThan(1000);
  });
});
