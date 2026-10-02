/**
 * Scene videos and chapters: locate the rendered per-scene .mp4s in a session
 * project from assembly lists, preserving their order, and derive chapter
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

export function toAbsoluteLocalVideoPath(projectDir: string, videoPath: string): string {
  return path.resolve(projectDir, videoPath);
}

// Inspect small text files by content, not by a prescribed name or extension.
// Unsupported concat directives (trimming, explicit durations) cannot safely
// be interpreted as a sequence of whole clips.
async function findAssemblyLists(projectDir: string): Promise<string[][]> {
  const sequences = new Map<string, string[]>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "__pycache__", "partial_movie_files"].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.isFile()) continue;
      // Avoid loading generated media while allowing extensionless manifests.
      if (/\.(mp4|mov|mp3|wav|png|jpg|jpeg|webp|pdf|pyc)$/i.test(entry.name)) continue;
      try {
        if ((await fsp.stat(file)).size > 256 * 1024) continue;
        const text = await fsp.readFile(file, "utf8");
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
        if (!lines.length || lines.some(line => line !== "ffconcat version 1.0" && parseConcatFile(line).length !== 1)) continue;
        const paths = parseConcatFile(text).map(p => path.resolve(dir, p));
        if (!paths.length) continue;
        const root = await fsp.realpath(projectDir);
        // Reject missing inputs, directories, and paths outside this project.
        for (const input of paths) {
          const real = await fsp.realpath(input);
          const relative = path.relative(root, real);
          if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || !/\.(mp4|mov)$/i.test(real) || !(await fsp.stat(real)).isFile()) throw Error("Invalid clip");
        }
        const relative = paths.map(p => path.relative(projectDir, p));
        sequences.set(JSON.stringify(relative), relative);
      } catch {
        // Files can disappear during generation. Never keep a partial sequence.
      }
    }
  }
  await walk(projectDir);
  return [...sequences.values()];
}

export async function getLocalSceneVideoPaths(projectDir: string): Promise<string[]> {
  const sequences = await findAssemblyLists(projectDir);
  return sequences.length === 1 ? sequences[0] : [];
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
  const filename = path.basename(videoPath).replace(/\.(mp4|mov)$/i, "");
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

async function deriveChapters(projectDir: string, sequences: string[][]): Promise<LocalChapter[]> {
  if (sequences.length !== 1) return [];
  const paths = sequences[0];
  const durations = await Promise.all(paths.map(file =>
    getMediaDurationSeconds(toAbsoluteLocalVideoPath(projectDir, file))
  ));
  if (durations.some(duration => !Number.isFinite(duration) || duration <= 0)) return [];
  let offset = 0;
  return paths.map((file, index) => {
    const chapter = {name: toChapterName(file), start: roundToMillis(offset), duration: roundToMillis(durations[index])};
    offset += durations[index];
    return chapter;
  });
}

// Cache expensive media inspection, not session metadata indefinitely. Re-read
// lists and stat every input on each request so edits invalidate this result.
const chapterCache = new Map<string, {key: string; result: Promise<LocalChapter[]>}>();
export async function readLocalProjectChapters(projectDir: string): Promise<LocalChapter[]> {
  const sequences = await findAssemblyLists(projectDir);
  const files = [...new Set(["video.mp4", ...sequences.flat()])];
  const stamps = await Promise.all(files.map(async file => {
    try {
      const stat = await fsp.stat(path.resolve(projectDir, file));
      return [file, stat.size, stat.mtimeMs, stat.ctimeMs];
    } catch { return [file, null]; }
  }));
  const key = JSON.stringify([sequences, stamps]);
  const cached = chapterCache.get(projectDir);
  if (cached?.key === key) return cached.result;
  const result = deriveChapters(projectDir, sequences);
  chapterCache.set(projectDir, {key, result});
  if (chapterCache.size > 32) chapterCache.delete(chapterCache.keys().next().value!);
  try {
    const chapters = await result;
    if (!chapters.length && chapterCache.get(projectDir)?.result === result) chapterCache.delete(projectDir);
    return chapters;
  } catch (error) {
    if (chapterCache.get(projectDir)?.result === result) chapterCache.delete(projectDir);
    throw error;
  }
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
