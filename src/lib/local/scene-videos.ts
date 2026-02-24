import fsp from "node:fs/promises";
import path from "node:path";
import { parseConcatFile } from "@/lib/subtitles";

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
