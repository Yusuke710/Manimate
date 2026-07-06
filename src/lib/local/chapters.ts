/**
 * Scene videos and chapters: locate the rendered per-scene .mp4s in a session
 * project (via concat.txt, falling back to a media scan) and derive chapter
 * markers from them.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { runLocalCommand } from "@/lib/local/command";

export interface LocalChapter {
  name: string;
  start: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// Scene video discovery
// ---------------------------------------------------------------------------

export function parseConcatFile(content: string): string[] {
  const paths: string[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Accept single-quoted, double-quoted, and unquoted ffmpeg concat entries.
    const match = line.match(/^file\s+(?:(['"])(.*?)\1|(.+?))(?:\s+#.*)?$/);
    if (!match) continue;

    const filePath = (match[2] ?? match[3] ?? "").trim();
    if (filePath) {
      paths.push(filePath);
    }
  }

  return paths;
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

function normalizeRelativePath(projectDir: string, filePath: string): string {
  const relative = path.relative(projectDir, filePath);
  return relative.split(path.sep).join("/");
}

export function toAbsoluteLocalVideoPath(projectDir: string, videoPath: string): string {
  return path.isAbsolute(videoPath)
    ? videoPath
    : path.resolve(projectDir, videoPath);
}

async function getVideoPathsFromConcat(projectDir: string): Promise<string[]> {
  const concatPath = path.join(projectDir, "concat.txt");
  const concat = await readTextFileIfExists(concatPath);
  if (!concat?.trim()) return [];

  const parsed = parseConcatFile(concat);
  if (parsed.length === 0) return [];

  const existing: string[] = [];
  for (const parsedPath of parsed) {
    const absolute = toAbsoluteLocalVideoPath(projectDir, parsedPath);
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
          // Ignore transient files.
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

export async function getLocalSceneVideoPaths(projectDir: string): Promise<string[]> {
  const concatPaths = await getVideoPathsFromConcat(projectDir);
  if (concatPaths.length > 0) return concatPaths;
  return getVideoPathsFromMediaScan(projectDir);
}

export async function getMediaDurationSeconds(filePath: string): Promise<number> {
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

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

function roundToMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function toChapterName(videoPath: string): string {
  const filename = path.basename(videoPath).replace(/\.mp4$/i, "");
  const withoutPrefix = filename.replace(/^\d+[\s_-]*/, "");
  const withSpaces = withoutPrefix
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

  if (withSpaces) {
    return withSpaces;
  }
  return filename || "Scene";
}

export async function readLocalProjectChapters(
  projectDir: string
): Promise<LocalChapter[]> {
  const videoPaths = await getLocalSceneVideoPaths(projectDir);
  if (videoPaths.length === 0) return [];

  const durations = await Promise.all(
    videoPaths.map(async (videoPath) => {
      const absoluteVideoPath = toAbsoluteLocalVideoPath(projectDir, videoPath);
      return getMediaDurationSeconds(absoluteVideoPath);
    })
  );

  const chapters: LocalChapter[] = [];
  let offset = 0;

  for (let i = 0; i < videoPaths.length; i += 1) {
    const duration = durations[i] ?? 0;
    if (!Number.isFinite(duration) || duration <= 0) {
      continue;
    }

    chapters.push({
      name: toChapterName(videoPaths[i]),
      start: roundToMillis(offset),
      duration: roundToMillis(duration),
    });

    offset += duration;
  }

  return chapters;
}

function isValidChapter(value: unknown): value is LocalChapter {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.start === "number" &&
    Number.isFinite(candidate.start) &&
    candidate.start >= 0 &&
    typeof candidate.duration === "number" &&
    Number.isFinite(candidate.duration) &&
    candidate.duration > 0
  );
}

export function parseStoredLocalChapters(raw: string | null | undefined): LocalChapter[] {
  if (!raw?.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidChapter);
  } catch {
    return [];
  }
}

export function serializeLocalChapters(chapters: LocalChapter[]): string | null {
  if (!chapters.length) return null;
  return JSON.stringify(chapters);
}
