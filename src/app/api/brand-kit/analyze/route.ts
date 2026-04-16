import { NextRequest, NextResponse } from "next/server";
import {
  ALL_BRAND_KIT_FONT_NAMES,
  type BrandKitAnalysisResult,
  normalizeBrandKitAnalysisResult,
  normalizeBrandKitImageMediaType,
} from "@/lib/brand-kit-analysis";

export const runtime = "nodejs";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const BRAND_KIT_MODEL =
  process.env.ANTHROPIC_BRAND_KIT_MODEL?.trim() || "claude-sonnet-4-20250514";
const TOOL_NAME = "extract_brand_kit";
const UNSUPPORTED_IMAGE_MESSAGE = "Auto-fill supports PNG, JPG, GIF, or WebP images.";

type BrandKitAnalyzeRequest = {
  imageDataUrl?: string;
};

type ParsedImageData = {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  base64Data: string;
};

type AnthropicResponseBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; name?: string; input?: unknown };

const BRAND_KIT_TOOL = {
  name: TOOL_NAME,
  description: "Extract a simple brand kit from a single brand image.",
  input_schema: {
    type: "object",
    properties: {
      colors: {
        type: "object",
        properties: {
          primary: {
            type: "array",
            items: { type: "string" },
            description: "1-3 primary brand colors as lowercase hex codes",
          },
          accent: {
            type: "array",
            items: { type: "string" },
            description: "0-2 accent brand colors as lowercase hex codes",
          },
          background: {
            type: "array",
            items: { type: "string" },
            description: "0-2 neutral or background colors as lowercase hex codes",
          },
        },
        required: ["primary", "accent", "background"],
        additionalProperties: false,
      },
      fonts: {
        type: "array",
        items: { type: "string" },
        description: "1-2 font names chosen only from the provided allowed list",
      },
    },
    required: ["colors", "fonts"],
    additionalProperties: false,
  },
} as const;

function buildPrompt(): string {
  return [
    "Analyze this brand image and extract a compact brand kit.",
    "Return 1-3 primary colors, 0-2 accent colors, and 0-2 background or neutral colors as lowercase hex codes.",
    "If text is visible, choose 1-2 font names only from this allowed list:",
    ALL_BRAND_KIT_FONT_NAMES.join(", "),
    "If no readable text is visible, return an empty fonts array.",
    "Do not include explanations.",
  ].join("\n");
}

function parseImageDataUrl(imageDataUrl: string): ParsedImageData | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(imageDataUrl);
  if (!match) return null;

  const mediaType = normalizeBrandKitImageMediaType(match[1]);
  const base64Data = match[2].trim();
  if (!mediaType || !base64Data) return null;

  return { mediaType, base64Data };
}

function getAnthropicErrorMessage(body: unknown, status: number): string {
  const message =
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
      ? body.error.message
      : null;

  return message ?? `Anthropic request failed (${status})`;
}

function extractAnalysisResult(payload: unknown): BrandKitAnalysisResult {
  const content =
    payload &&
    typeof payload === "object" &&
    "content" in payload &&
    Array.isArray(payload.content)
      ? (payload.content as AnthropicResponseBlock[])
      : [];

  const toolUseBlock = content.find(
    (block) => block.type === "tool_use" && block.name === TOOL_NAME
  );
  if (toolUseBlock?.type === "tool_use") {
    return normalizeBrandKitAnalysisResult(toolUseBlock.input);
  }

  const textFallback = content
    .filter((block): block is { type: "text"; text?: string } => block.type === "text")
    .map((block) => block.text?.trim() || "")
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);

  throw new Error(
    textFallback
      ? `Anthropic returned an unexpected response: ${textFallback}`
      : "Anthropic returned no structured brand kit data."
  );
}

async function analyzeBrandImage(image: ParsedImageData): Promise<BrandKitAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: BRAND_KIT_MODEL,
      max_tokens: 512,
      temperature: 0,
      tool_choice: { type: "tool", name: TOOL_NAME },
      tools: [BRAND_KIT_TOOL],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64Data,
              },
            },
            {
              type: "text",
              text: buildPrompt(),
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new Error(getAnthropicErrorMessage(body, res.status));
  }

  return extractAnalysisResult(body);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: BrandKitAnalyzeRequest = {};
  try {
    body = (await req.json()) as BrandKitAnalyzeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.imageDataUrl?.startsWith("data:image/")) {
    return NextResponse.json({ error: "imageDataUrl is required" }, { status: 400 });
  }

  const image = parseImageDataUrl(body.imageDataUrl);
  if (!image) {
    return NextResponse.json({ error: UNSUPPORTED_IMAGE_MESSAGE }, { status: 400 });
  }

  try {
    const result = await analyzeBrandImage(image);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("ANTHROPIC_API_KEY")
      ? 503
      : message === UNSUPPORTED_IMAGE_MESSAGE
        ? 400
        : 502;

    return NextResponse.json({ error: message }, { status });
  }
}
