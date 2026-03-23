/**
 * Thumbnail generation for completed sessions.
 *
 * Uses FFmpeg's built-in `thumbnail` filter which analyzes N evenly-spaced
 * frames and selects the one closest to the mean histogram — i.e. the most
 * "representative" / content-rich frame, similar to YouTube's approach.
 *
 * Called fire-and-forget immediately after a video is rendered.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const THUMBNAIL_FILENAME = "thumbnail.jpg";
const THUMBNAIL_FILTER = "fps=1,thumbnail=300";

function getThumbnailPath(sessionRoot: string): string {
  return path.join(sessionRoot, THUMBNAIL_FILENAME);
}

function getThumbnailArgs(videoPath: string, thumbPath: string): string[] {
  return [
    "-y",
    "-i", videoPath,
    "-vf", THUMBNAIL_FILTER,
    "-frames:v", "1",
    "-q:v", "3",
    thumbPath,
  ];
}

export async function generateThumbnail(videoPath: string, sessionRoot: string): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", getThumbnailArgs(videoPath, getThumbnailPath(sessionRoot)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates thumbnail.jpg in sessionRoot from videoPath.
 * Safe to call multiple times.
 * Errors are swallowed (ffmpeg may not be installed, that's OK).
 */
export function generateThumbnailAsync(videoPath: string, sessionRoot: string): void {
  void generateThumbnail(videoPath, sessionRoot);
}

/**
 * Returns true if a cached thumbnail exists for the session.
 */
export function thumbnailExists(sessionRoot: string): boolean {
  return existsSync(getThumbnailPath(sessionRoot));
}

/**
 * Returns an existing thumbnail path, or lazily generates one for older sessions.
 */
export async function ensureThumbnail(sessionRoot: string, videoPath: string | null): Promise<string | null> {
  const thumbPath = getThumbnailPath(sessionRoot);
  if (existsSync(thumbPath)) return thumbPath;
  if (!videoPath || !existsSync(videoPath)) return null;
  return (await generateThumbnail(videoPath, sessionRoot)) ? thumbPath : null;
}
