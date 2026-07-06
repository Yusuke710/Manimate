/**
 * Voiceover: subtitles for the rendered project (TTS timestamps first, then
 * per-scene .srt concatenation) and the ElevenLabs API key configuration.
 */

import fsp from "node:fs/promises";
import {
  getLocalSceneVideoPaths,
  getMediaDurationSeconds,
  toAbsoluteLocalVideoPath,
} from "@/lib/local/chapters";
import { readStoredLocalConfig, updateStoredLocalConfig } from "@/lib/local/local-config-store";

// ---------------------------------------------------------------------------
// SRT parsing
// ---------------------------------------------------------------------------

const SRT_TIME_REGEX = /(\d+):(\d+):(\d+)[,.](\d+)/;
const SRT_RANGE_REGEX =
  /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/;

export function parseSrtTime(time: string): number {
  const match = time.match(SRT_TIME_REGEX);
  if (!match) return 0;
  return (
    parseInt(match[1], 10) * 3600 +
    parseInt(match[2], 10) * 60 +
    parseInt(match[3], 10) +
    parseInt(match[4], 10) / 1000
  );
}

export function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

interface LocalSubtitleEntry {
  start: number;
  end: number;
  text: string;
}

function parseSrtEntries(content: string): LocalSubtitleEntry[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\n+/);
  const entries: LocalSubtitleEntry[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;

    let timeLineIndex = 0;
    let timeMatch = lines[timeLineIndex]?.match(SRT_RANGE_REGEX);
    if (!timeMatch && lines.length > 1) {
      timeLineIndex = 1;
      timeMatch = lines[timeLineIndex]?.match(SRT_RANGE_REGEX);
    }
    if (!timeMatch) continue;

    const text = lines.slice(timeLineIndex + 1).join("\n").trim();
    if (!text) continue;

    entries.push({
      start: parseSrtTime(timeMatch[1]),
      end: parseSrtTime(timeMatch[2]),
      text,
    });
  }

  return entries;
}

function serializeSrtEntries(entries: LocalSubtitleEntry[]): string | null {
  const output = entries.map((entry, index) =>
    `${index + 1}\n${formatSrtTime(entry.start)} --> ${formatSrtTime(entry.end)}\n${entry.text}`
  );
  return output.length > 0 ? `${output.join("\n\n")}\n` : null;
}

// ---------------------------------------------------------------------------
// Project subtitles
// ---------------------------------------------------------------------------

interface TimestampSubtitleEntry {
  start_s?: unknown;
  end_s?: unknown;
  text?: unknown;
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readTimestampSubtitles(projectDir: string): Promise<string | null> {
  const content = await readTextFileIfExists(`${projectDir}/timestamps.json`);
  if (!content?.trim()) return null;

  try {
    const parsed = JSON.parse(content) as { subtitles?: unknown };
    if (!Array.isArray(parsed.subtitles)) return null;

    const entries: LocalSubtitleEntry[] = [];
    for (const item of parsed.subtitles) {
      const entry = item as TimestampSubtitleEntry;
      const start = typeof entry.start_s === "number" ? entry.start_s : NaN;
      const end = typeof entry.end_s === "number" ? entry.end_s : NaN;
      const text = typeof entry.text === "string" ? entry.text.trim() : "";

      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }

      entries.push({ start, end, text });
    }

    return serializeSrtEntries(entries);
  } catch {
    return null;
  }
}

export async function readLocalProjectSubtitles(
  projectDir: string
): Promise<string | null> {
  const timestampSubtitles = await readTimestampSubtitles(projectDir);
  if (timestampSubtitles) return timestampSubtitles;

  const videoPaths = await getLocalSceneVideoPaths(projectDir);
  const sceneEntries: LocalSubtitleEntry[] = [];
  let offset = 0;

  for (const videoPath of videoPaths) {
    const absoluteVideoPath = toAbsoluteLocalVideoPath(projectDir, videoPath);
    const sceneSrtPath = absoluteVideoPath.replace(/\.mp4$/i, ".srt");
    const sceneContent = await readTextFileIfExists(sceneSrtPath);

    if (sceneContent?.trim()) {
      const entries = parseSrtEntries(sceneContent);
      for (const entry of entries) {
        sceneEntries.push({
          start: entry.start + offset,
          end: entry.end + offset,
          text: entry.text,
        });
      }
    }

    const duration = await getMediaDurationSeconds(absoluteVideoPath);
    offset += duration;
  }

  return serializeSrtEntries(sceneEntries);
}

// ---------------------------------------------------------------------------
// ElevenLabs API key configuration
// ---------------------------------------------------------------------------

const ELEVENLABS_API_KEY_FIELD = "elevenlabs_api_key";
const MAX_API_KEY_LENGTH = 1024;

export type ElevenLabsApiKeySource = "saved" | "env";

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_API_KEY_LENGTH) return null;
  return trimmed;
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`;
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function getSavedElevenLabsApiKey(): string | null {
  const config = readStoredLocalConfig();
  return normalizeApiKey(config[ELEVENLABS_API_KEY_FIELD]);
}

export function writeSavedElevenLabsApiKey(apiKey: string): string {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    throw new Error("ElevenLabs API key is required");
  }

  updateStoredLocalConfig((current) => ({
    ...current,
    [ELEVENLABS_API_KEY_FIELD]: normalized,
  }));

  return normalized;
}

export function clearSavedElevenLabsApiKey(): void {
  updateStoredLocalConfig((current) => {
    const next = { ...current };
    delete next[ELEVENLABS_API_KEY_FIELD];
    return next;
  });
}

export function getResolvedElevenLabsApiKey(
  sourceEnv: NodeJS.ProcessEnv = process.env
): { apiKey: string | null; source: ElevenLabsApiKeySource | null } {
  const saved = getSavedElevenLabsApiKey();
  if (saved) {
    return { apiKey: saved, source: "saved" };
  }

  const envApiKey = normalizeApiKey(sourceEnv.ELEVENLABS_API_KEY);
  if (envApiKey) {
    return { apiKey: envApiKey, source: "env" };
  }

  return { apiKey: null, source: null };
}

export function getElevenLabsApiKeyStatus(
  sourceEnv: NodeJS.ProcessEnv = process.env
): {
  configured: boolean;
  source: ElevenLabsApiKeySource | null;
  maskedKey: string | null;
} {
  const resolved = getResolvedElevenLabsApiKey(sourceEnv);
  return {
    configured: Boolean(resolved.apiKey),
    source: resolved.source,
    maskedKey: resolved.apiKey ? maskApiKey(resolved.apiKey) : null,
  };
}
