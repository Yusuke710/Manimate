import fsp from "node:fs/promises";
import {
  formatSrtTime,
  parseSrtTime,
} from "@/lib/subtitles";
import { runLocalCommand } from "@/lib/local/command";
import {
  getLocalSceneVideoPaths,
  toAbsoluteLocalVideoPath,
} from "@/lib/local/scene-videos";

const SRT_RANGE_REGEX =
  /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/;

interface LocalSubtitleEntry {
  start: number;
  end: number;
  text: string;
}

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

async function getMediaDurationSeconds(filePath: string): Promise<number> {
  const result = await runLocalCommand({
    command: "ffprobe",
    args: ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
    timeoutMs: 20_000,
  });

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return 0;
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string };
    };
    const duration = parsed.format?.duration
      ? Number.parseFloat(parsed.format.duration)
      : 0;
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
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
