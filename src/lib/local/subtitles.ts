import fsp from "node:fs/promises";
import path from "node:path";
import {
  formatSrtTime,
  parseConcatFile,
  parseSrtTime,
} from "@/lib/subtitles";
import { runLocalCommand } from "@/lib/local/command";

const SRT_RANGE_REGEX =
  /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/;

interface LocalSubtitleEntry {
  start: number;
  end: number;
  text: string;
}

interface LocalVideoCandidate {
  absolutePath: string;
  parentDir: string;
  mtimeMs: number;
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
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

function normalizeRelativePath(projectDir: string, filePath: string): string {
  const relative = path.relative(projectDir, filePath);
  return relative.split(path.sep).join("/");
}

function toAbsoluteVideoPath(projectDir: string, videoPath: string): string {
  return path.isAbsolute(videoPath)
    ? videoPath
    : path.resolve(projectDir, videoPath);
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

async function getVideoPathsFromConcat(projectDir: string): Promise<string[]> {
  const concatPath = path.join(projectDir, "concat.txt");
  const concat = await readTextFileIfExists(concatPath);
  if (!concat?.trim()) return [];

  const parsed = parseConcatFile(concat);
  if (parsed.length === 0) return [];

  const existing: string[] = [];
  for (const parsedPath of parsed) {
    const absolute = toAbsoluteVideoPath(projectDir, parsedPath);
    if (await fileExists(absolute)) {
      existing.push(normalizeRelativePath(projectDir, absolute));
    }
  }
  return existing;
}

async function collectVideosRecursively(rootDir: string): Promise<LocalVideoCandidate[]> {
  const candidates: LocalVideoCandidate[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "partial_movie_files") return;
          await walk(absolutePath);
          return;
        }
        if (!entry.isFile()) return;
        if (!entry.name.toLowerCase().endsWith(".mp4")) return;
        if (entry.name === "video.mp4") return;

        try {
          const stats = await fsp.stat(absolutePath);
          candidates.push({
            absolutePath,
            parentDir: path.dirname(absolutePath),
            mtimeMs: stats.mtimeMs,
          });
        } catch {
          // Skip transient files.
        }
      })
    );
  }

  await walk(rootDir);
  return candidates;
}

async function getVideoPathsFromMediaScan(projectDir: string): Promise<string[]> {
  const mediaVideosDir = path.join(projectDir, "media", "videos");
  const candidates = await collectVideosRecursively(mediaVideosDir);
  if (candidates.length === 0) return [];

  const newest = candidates.reduce((best, current) =>
    current.mtimeMs > best.mtimeMs ? current : best
  );
  const sameDir = candidates
    .filter((item) => item.parentDir === newest.parentDir)
    .map((item) => item.absolutePath)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return sameDir.map((absolutePath) =>
    normalizeRelativePath(projectDir, absolutePath)
  );
}

async function getSceneVideoPaths(projectDir: string): Promise<string[]> {
  const concatPaths = await getVideoPathsFromConcat(projectDir);
  if (concatPaths.length > 0) return concatPaths;
  return getVideoPathsFromMediaScan(projectDir);
}

export async function readLocalProjectSubtitles(
  projectDir: string
): Promise<string | null> {
  const rootSubtitlePath = path.join(projectDir, "subtitles.srt");
  const rootSubtitle = await readTextFileIfExists(rootSubtitlePath);
  if (rootSubtitle?.trim()) {
    return rootSubtitle;
  }

  const videoPaths = await getSceneVideoPaths(projectDir);
  if (videoPaths.length === 0) return null;

  const outputEntries: string[] = [];
  let nextIndex = 1;
  let offset = 0;

  for (const videoPath of videoPaths) {
    const absoluteVideoPath = toAbsoluteVideoPath(projectDir, videoPath);
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
