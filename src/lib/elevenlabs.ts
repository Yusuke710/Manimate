/**
 * ElevenLabs TTS Module
 *
 * Handles text-to-speech generation using ElevenLabs API.
 * Supports single-call generation and optional parallel generation with concurrency limits.
 * Supports caption-level caching in sandbox to avoid redundant TTS calls.
 */

import { createHash } from "crypto";

import { DEFAULT_VOICE_ID } from "@/lib/voices";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const FALLBACK_MODEL_IDS = ["eleven_turbo_v2_5", "eleven_multilingual_v2"] as const;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ElevenLabs Creator plan pay-as-you-go rate: $0.30 per 1000 characters
const TTS_BASE_RATE_PER_CHAR = 0.30 / 1000;

// Model cost multipliers relative to base rate (flash/turbo are ~50% cheaper)
const MODEL_COST_MULTIPLIERS: Record<string, number> = {
  eleven_multilingual_v2: 1.0,
  eleven_flash_v2_5: 0.5,
  eleven_turbo_v2_5: 0.5,
};

class ElevenLabsApiError extends Error {
  readonly statusCode: number;
  readonly providerStatus: string | null;

  constructor(message: string, statusCode: number, providerStatus: string | null = null) {
    super(message);
    this.name = "ElevenLabsApiError";
    this.statusCode = statusCode;
    this.providerStatus = providerStatus;
  }
}

export interface TTSResult {
  audio: Buffer;
  characterCount: number;
  modelIdUsed: string;
}

export function getTTSCostUsd(characterCount: number, modelId: string): number {
  const multiplier = MODEL_COST_MULTIPLIERS[modelId] ?? 1.0;
  return characterCount * TTS_BASE_RATE_PER_CHAR * multiplier;
}

export interface Caption {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface AudioSegment {
  index: number;
  start: number;  // subtitle start time in seconds
  end: number;    // subtitle end time in seconds
  audio: Buffer;
  cached?: boolean; // true if loaded from cache
}

/**
 * Ordered list of TTS models to try for a caption.
 * Defaults to flash (cheapest), then falls back to turbo, then multilingual
 * when the provider reports quota_exceeded.
 */
export function getTTSModelCandidates(preferredModelId: string = DEFAULT_MODEL_ID): string[] {
  const candidates = [preferredModelId, ...FALLBACK_MODEL_IDS];
  return Array.from(new Set(candidates));
}

/**
 * Generate a cache key for a caption based on text, voice, and model settings.
 * Uses SHA-256 hash truncated to 16 chars for reasonable uniqueness + readability.
 */
export function getCaptionCacheKey(
  text: string,
  voiceId: string,
  modelId: string = DEFAULT_MODEL_ID
): string {
  const hash = createHash("sha256");
  hash.update(`${voiceId}:${modelId}:${text}`);
  return hash.digest("hex").slice(0, 16);
}

/**
 * Parse SRT content into Caption objects
 */
export function parseSRT(srtContent: string): Caption[] {
  const normalized = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\n+/);

  return blocks
    .map((block, idx) => {
      const lines = block.split("\n");
      const timeMatch = lines[1]?.match(
        /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/
      );
      if (!timeMatch) return null;

      const start =
        +timeMatch[1] * 3600 +
        +timeMatch[2] * 60 +
        +timeMatch[3] +
        +timeMatch[4] / 1000;
      const end =
        +timeMatch[5] * 3600 +
        +timeMatch[6] * 60 +
        +timeMatch[7] +
        +timeMatch[8] / 1000;
      const text = lines.slice(2).join(" ").trim();

      return { index: idx, start, end, text };
    })
    .filter((c): c is Caption => c !== null && c.text.length > 0);
}

function parseApiError(statusCode: number, errorText: string): ElevenLabsApiError {
  try {
    const parsed = JSON.parse(errorText) as {
      detail?: { status?: string; message?: string } | string;
    };

    if (parsed && typeof parsed === "object" && parsed.detail) {
      if (typeof parsed.detail === "object") {
        const providerStatus =
          typeof parsed.detail.status === "string" ? parsed.detail.status : null;
        const providerMessage =
          typeof parsed.detail.message === "string"
            ? parsed.detail.message
            : errorText;
        return new ElevenLabsApiError(
          `ElevenLabs API error: ${statusCode} - ${providerMessage}`,
          statusCode,
          providerStatus
        );
      }
      if (typeof parsed.detail === "string") {
        return new ElevenLabsApiError(
          `ElevenLabs API error: ${statusCode} - ${parsed.detail}`,
          statusCode,
          null
        );
      }
    }
  } catch {
    // Fall through to raw error text.
  }

  return new ElevenLabsApiError(
    `ElevenLabs API error: ${statusCode} - ${errorText}`,
    statusCode,
    null
  );
}

/**
 * Generate TTS audio for a single text payload
 */
export async function generateTTSForCaption(
  text: string,
  apiKey: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<TTSResult> {
  const modelCandidates = getTTSModelCandidates();
  let lastError: Error | null = null;

  for (const modelId of modelCandidates) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const url = `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        });

        if (response.status === 429) {
          // Rate limited - wait and retry same model
          const retryAfter = parseInt(response.headers.get("retry-after") || "5", 10);
          console.log(`[ElevenLabs] Rate limited, waiting ${retryAfter}s...`);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          const parsedError = parseApiError(response.status, errorText);

          // On quota errors, try a cheaper fallback model (if available).
          if (parsedError.providerStatus === "quota_exceeded") {
            lastError = parsedError;
            if (modelId !== modelCandidates[modelCandidates.length - 1]) {
              console.warn(
                `[ElevenLabs] Quota exceeded on ${modelId}, trying fallback model`
              );
              break;
            }
            throw parsedError;
          }

          throw parsedError;
        }

        const characterCount =
          parseInt(response.headers.get("x-character-count") || "0", 10) || text.length;
        const arrayBuffer = await response.arrayBuffer();

        if (modelId !== DEFAULT_MODEL_ID) {
          console.log(
            `[ElevenLabs] Generated with fallback model ${modelId} (${characterCount} chars)`
          );
        }

        return {
          audio: Buffer.from(arrayBuffer),
          characterCount,
          modelIdUsed: modelId,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Quota errors should switch model immediately, not retry the same model.
        if (
          lastError instanceof ElevenLabsApiError &&
          lastError.providerStatus === "quota_exceeded"
        ) {
          break;
        }

        if (attempt < MAX_RETRIES - 1) {
          console.log(
            `[ElevenLabs] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${lastError.message}`
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }
  }

  throw lastError || new Error("TTS generation failed after retries");
}

/**
 * Generate TTS audio for a full script (single call)
 */
export async function generateTTSForText(
  text: string,
  apiKey: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<TTSResult> {
  return generateTTSForCaption(text, apiKey, voiceId);
}

/**
 * Generate TTS audio for multiple captions in parallel with concurrency limit
 */
export async function generateTTSParallel(
  captions: Caption[],
  apiKey: string,
  voiceId: string = DEFAULT_VOICE_ID,
  concurrency: number = 5
): Promise<AudioSegment[]> {
  const segments: AudioSegment[] = [];
  const queue = [...captions];

  // Process in batches
  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const batchResults = await Promise.all(
      batch.map(async (caption) => {
        console.log(`[ElevenLabs] Generating TTS for caption ${caption.index}: "${caption.text.slice(0, 50)}..."`);
        const result = await generateTTSForCaption(caption.text, apiKey, voiceId);
        return {
          index: caption.index,
          start: caption.start,
          end: caption.end,
          audio: result.audio,
        };
      })
    );
    segments.push(...batchResults);
  }

  // Sort by index to maintain order
  return segments.sort((a, b) => a.index - b.index);
}

/**
 * Check if ElevenLabs is configured
 */
export function isElevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Get the API key and voice ID from environment
 */
export function getElevenLabsConfig(): { apiKey: string; voiceId: string } | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  return { apiKey, voiceId: DEFAULT_VOICE_ID };
}
