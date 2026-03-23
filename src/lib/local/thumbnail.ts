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

/**
 * Generates thumbnail.jpg in sessionRoot from videoPath.
 * Safe to call multiple times — regenerates only if video is newer.
 * Errors are swallowed (ffmpeg may not be installed, that's OK).
 */
export function generateThumbnailAsync(videoPath: string, sessionRoot: string): void {
  const thumbPath = path.join(sessionRoot, "thumbnail.jpg");

  // Always regenerate on new video (caller already verified video changed).
  //
  // Filter chain: fps=1 downsamples to 1 frame/sec so thumbnail=300 covers
  // the full video (up to 300 seconds). The thumbnail filter then picks the
  // single most-representative frame across the entire downsampled sequence.
  execFile(
    "ffmpeg",
    [
      "-y",
      "-i", videoPath,
      "-vf", "fps=1,thumbnail=300",
      "-frames:v", "1",
      "-q:v", "3",
      thumbPath,
    ],
    // Fire-and-forget: ignore errors (ffmpeg missing, corrupt file, etc.)
    () => {},
  );
}

/**
 * Returns true if a cached thumbnail exists for the session.
 */
export function thumbnailExists(sessionRoot: string): boolean {
  return existsSync(path.join(sessionRoot, "thumbnail.jpg"));
}
