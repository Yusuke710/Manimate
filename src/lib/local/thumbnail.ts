/**
 * Thumbnail generation for completed sessions.
 *
 * Uses FFmpeg's built-in `thumbnail` filter which analyzes N evenly-spaced
 * frames and selects the one closest to the mean histogram — i.e. the most
 * "representative" / content-rich frame, similar to YouTube's approach.
 * If that does not produce a thumbnail, fall back to a frame 25% into the
 * video. This primarily helps older sessions that only generate thumbnails
 * lazily when first viewed in the library.
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
const FALLBACK_THUMBNAIL_RATIO = 0.25;

function getThumbnailPath(sessionRoot: string): string {
  return path.join(sessionRoot, THUMBNAIL_FILENAME);
}

function getSingleImageOutputArgs(thumbPath: string): string[] {
  return [
    "-frames:v", "1",
    "-update", "1",
    "-q:v", "3",
    thumbPath,
  ];
}

function getThumbnailArgs(videoPath: string, thumbPath: string): string[] {
  return [
    "-y",
    "-i", videoPath,
    "-vf", THUMBNAIL_FILTER,
    ...getSingleImageOutputArgs(thumbPath),
  ];
}

export function getFallbackSeekSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return durationSeconds * FALLBACK_THUMBNAIL_RATIO;
}

function formatSeekSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0";
  return seconds.toFixed(3);
}

export function getFallbackThumbnailArgs(
  videoPath: string,
  thumbPath: string,
  durationSeconds: number
): string[] {
  return [
    "-y",
    "-ss", formatSeekSeconds(getFallbackSeekSeconds(durationSeconds)),
    "-i", videoPath,
    ...getSingleImageOutputArgs(thumbPath),
  ];
}

async function getVideoDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const durationSeconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  } catch {
    return null;
  }
}

async function generateThumbnailFallback(videoPath: string, thumbPath: string): Promise<boolean> {
  const durationSeconds = await getVideoDurationSeconds(videoPath);
  if (durationSeconds === null) return false;

  try {
    await execFileAsync("ffmpeg", getFallbackThumbnailArgs(videoPath, thumbPath, durationSeconds));
    return existsSync(thumbPath);
  } catch {
    return false;
  }
}

export async function generateThumbnail(videoPath: string, sessionRoot: string): Promise<boolean> {
  const thumbPath = getThumbnailPath(sessionRoot);

  try {
    await execFileAsync("ffmpeg", getThumbnailArgs(videoPath, thumbPath));
    if (existsSync(thumbPath)) return true;
  } catch {
    // Fall through to the 25%-duration fallback below.
  }

  const fallbackWorked = await generateThumbnailFallback(videoPath, thumbPath);
  if (fallbackWorked) {
    console.info(`[thumbnail] Used 25% fallback for ${videoPath}`);
  }
  if (!fallbackWorked) {
    console.warn(`[thumbnail] Failed to generate thumbnail for ${videoPath}`);
  }
  return fallbackWorked;
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
