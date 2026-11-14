import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getMediaDurationSeconds } from "./chapters";

const execute = promisify(execFile);

/** Select a representative frame, falling back to 25% of the video. */
export async function generateThumbnail(videoPath: string, sessionRoot: string): Promise<boolean> {
  const target = path.join(sessionRoot, "thumbnail.jpg");
  const output = ["-frames:v", "1", "-update", "1", "-q:v", "3", target];
  try {
    await execute("ffmpeg", ["-y", "-i", videoPath, "-vf", "fps=1,thumbnail=300", ...output]);
    if (existsSync(target)) return true;
  } catch { /* Try a single frame if representative-frame selection fails. */ }

  const duration = await getMediaDurationSeconds(videoPath);
  if (duration > 0) {
    try {
      await execute("ffmpeg", ["-y", "-ss", (duration * 0.25).toFixed(3), "-i", videoPath, ...output]);
      return existsSync(target);
    } catch { /* Thumbnails are optional; ffmpeg may be unavailable. */ }
  }
  console.warn(`[thumbnail] Failed to generate thumbnail for ${videoPath}`);
  return false;
}

export function getExistingThumbnailPath(sessionRoot: string): string | null {
  const target = path.join(sessionRoot, "thumbnail.jpg");
  return existsSync(target) ? target : null;
}
