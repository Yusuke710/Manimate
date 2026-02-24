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

export async function readLocalProjectSubtitles(
  projectDir: string
): Promise<string | null> {
  const rootSubtitlePath = `${projectDir}/subtitles.srt`;
  const rootSubtitle = await readTextFileIfExists(rootSubtitlePath);
  if (rootSubtitle?.trim()) {
    return rootSubtitle;
  }

  const videoPaths = await getLocalSceneVideoPaths(projectDir);
  if (videoPaths.length === 0) return null;

  const outputEntries: string[] = [];
  let nextIndex = 1;
  let offset = 0;

  for (const videoPath of videoPaths) {
    const absoluteVideoPath = toAbsoluteLocalVideoPath(projectDir, videoPath);
    const sceneSrtPath = absoluteVideoPath.replace(/\.mp4$/i, ".srt");
    const sceneContent = await readTextFileIfExists(sceneSrtPath);

    if (sceneContent?.trim()) {
      const entries = parseSrtEntries(sceneContent);
      for (const entry of entries) {
        outputEntries.push(
          `${nextIndex}\n${formatSrtTime(entry.start + offset)} --> ${formatSrtTime(entry.end + offset)}\n${entry.text}`
        );
        nextIndex += 1;
      }
    }

    const duration = await getMediaDurationSeconds(absoluteVideoPath);
    offset += duration;
  }

  if (outputEntries.length === 0) return null;
  return `${outputEntries.join("\n\n")}\n`;
}
