import path from "node:path";
import { runLocalCommand } from "@/lib/local/command";
import {
  getLocalSceneVideoPaths,
  toAbsoluteLocalVideoPath,
} from "@/lib/local/scene-videos";

export interface LocalChapter {
  name: string;
  start: number;
  duration: number;
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
