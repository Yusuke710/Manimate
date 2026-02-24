import fsp from "node:fs/promises";
import path from "node:path";
import {
  generateTTSForCaption,
  getElevenLabsConfig,
  parseSRT,
  type Caption,
} from "@/lib/elevenlabs";
import { parseVoiceoverFailure } from "@/lib/voiceover-error";
import {
  ensureLocalSessionLayout,
  localFileToApiUrl,
} from "@/lib/local/config";
import {
  getLocalSession,
  updateLocalSession,
} from "@/lib/local/db";
import { runLocalCommand } from "@/lib/local/command";
import { readLocalProjectSubtitles } from "@/lib/local/subtitles";

const VOICEOVER_CONCURRENCY = 3;
const MIN_SEGMENT_DURATION = 0.05;
const FADE_MS = 10;

interface StartVoiceoverOptions {
  force?: boolean;
  silentIfUnavailable?: boolean;
}

export interface StartVoiceoverResult {
  started: boolean;
  status: number;
  message: string;
}

interface ActiveVoiceoverJob {
  id: string;
  sessionId: string;
  startedAt: string;
  promise: Promise<void>;
}

interface GeneratedSegment {
  index: number;
  start: number;
  end: number;
  path: string;
  audioDuration: number;
}

const activeVoiceoverJobs = new Map<string, ActiveVoiceoverJob>();

function isVoiceoverInProgress(status: string | null | undefined): boolean {
  return status === "pending" || status === "generating";
}

function isCurrentJob(sessionId: string, jobId: string): boolean {
  return activeVoiceoverJobs.get(sessionId)?.id === jobId;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore missing files.
  }
}

async function safeRemoveDirectory(dirPath: string): Promise<void> {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

function buildAtempoChain(ratio: number): string[] {
  if (ratio <= 1.01) return [];

  const filters: string[] = [];
  let remaining = ratio;

  while (remaining > 2.0) {
    filters.push("atempo=2.0");
    remaining /= 2.0;
  }

  if (remaining > 1.01) {
    filters.push(`atempo=${remaining.toFixed(3)}`);
  }

  return filters;
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
    const rawDuration = parsed.format?.duration;
    const duration = rawDuration ? Number.parseFloat(rawDuration) : 0;
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

async function readSubtitles(sessionId: string): Promise<string | null> {
  const session = getLocalSession(sessionId);
  if (!session) return null;

  if (session.subtitles_content?.trim()) {
    return session.subtitles_content;
  }

  const { projectDir } = ensureLocalSessionLayout(sessionId);
  return readLocalProjectSubtitles(projectDir);
}

function buildTimedCaptions(captions: Caption[]): Caption[] {
  return captions.filter((caption) => {
    const duration = caption.end - caption.start;
    return duration >= MIN_SEGMENT_DURATION;
  });
}

async function generateCaptionBatch(
  captions: Caption[],
  apiKey: string,
  voiceId: string,
  tempDir: string
): Promise<GeneratedSegment[]> {
  const segments: GeneratedSegment[] = [];

  for (let i = 0; i < captions.length; i += VOICEOVER_CONCURRENCY) {
    const batch = captions.slice(i, i + VOICEOVER_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (caption) => {
        const tts = await generateTTSForCaption(caption.text, apiKey, voiceId);
        const segmentPath = path.join(tempDir, `voiceover_${caption.index}.mp3`);
        await fsp.writeFile(segmentPath, tts.audio);
        const audioDuration = await getMediaDurationSeconds(segmentPath);

        return {
          index: caption.index,
          start: caption.start,
          end: caption.end,
          path: segmentPath,
          audioDuration,
        } as GeneratedSegment;
      })
    );

    segments.push(...batchResults);
  }

  return segments.sort((a, b) => a.index - b.index);
}

async function buildSyncedAudioTrack(
  segments: GeneratedSegment[],
  outputPath: string
): Promise<void> {
  if (segments.length === 0) {
    throw new Error("No valid voiceover segments to mix");
  }

  const filterParts: string[] = [];
  const mixInputs: string[] = [];
  const args: string[] = ["-y"];

  for (const segment of segments) {
    args.push("-i", segment.path);
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const subtitleDuration = segment.end - segment.start;
    const delayMs = Math.round(segment.start * 1000);

    const ratio = segment.audioDuration > 0
      ? segment.audioDuration / subtitleDuration
      : 1;

    const filters: string[] = ["asetpts=PTS-STARTPTS"];
    if (ratio > 1.01) {
      filters.push(...buildAtempoChain(ratio));
    }

    filters.push(`atrim=0:${subtitleDuration.toFixed(3)}`);
    filters.push("asetpts=PTS-STARTPTS");

    const adjustedDuration = ratio > 0 ? segment.audioDuration / Math.max(ratio, 1) : subtitleDuration;
    const maxFade = Math.min(adjustedDuration || subtitleDuration, subtitleDuration) / 2;
    const fadeDuration = Math.min(FADE_MS / 1000, maxFade);

    if (fadeDuration > 0.001) {
      filters.push(`afade=t=in:d=${fadeDuration.toFixed(3)}`);
      const fadeOutStart = Math.max(0, subtitleDuration - fadeDuration);
      filters.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDuration.toFixed(3)}`);
    }

    if (delayMs > 0) {
      filters.push(`adelay=${delayMs}|${delayMs}`);
    }

    filterParts.push(`[${i}:a]${filters.join(",")}[a${i}]`);
    mixInputs.push(`[a${i}]`);
  }

  const filterComplex = `${filterParts.join(";")};${mixInputs.join("")}amix=inputs=${segments.length}:duration=longest:normalize=0[out]`;

  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-c:a",
    "aac",
    outputPath
  );

  const mix = await runLocalCommand({
    command: "ffmpeg",
    args,
    timeoutMs: 5 * 60 * 1000,
  });

  if (mix.exitCode !== 0) {
    throw new Error(mix.stderr.trim() || "Failed to build synced audio track");
  }
}

async function muxVideoWithAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<void> {
  const result = await runLocalCommand({
    command: "ffmpeg",
    args: [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      outputPath,
    ],
    timeoutMs: 3 * 60 * 1000,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Failed to mux audio into video");
  }
}

async function runVoiceoverJob(sessionId: string, jobId: string): Promise<void> {
  if (!isCurrentJob(sessionId, jobId)) return;

  const session = getLocalSession(sessionId);
  if (!session) {
    return;
  }

  const config = getElevenLabsConfig();
  if (!config) {
    if (!isCurrentJob(sessionId, jobId)) return;
    updateLocalSession(sessionId, {
      voiceover_status: "failed",
      voiceover_error: "ElevenLabs is not configured",
    });
    return;
  }

  const { projectDir, artifactsDir } = ensureLocalSessionLayout(sessionId);
  const videoPath = session.video_path || path.join(projectDir, "video.mp4");
  const sourceVideoStat = await fsp.stat(videoPath).catch(() => null);
  const selectedVoiceId = session.voice_id || config.voiceId;

  if (!(await fileExists(videoPath))) {
    if (!isCurrentJob(sessionId, jobId)) return;
    updateLocalSession(sessionId, {
      voiceover_status: "failed",
      voiceover_error: "No video found for this session",
    });
    return;
  }

  if (!isCurrentJob(sessionId, jobId)) return;
  updateLocalSession(sessionId, {
    voiceover_status: "generating",
    voiceover_error: null,
  });

  const subtitles = await readSubtitles(sessionId);
  if (!subtitles?.trim()) {
    if (!isCurrentJob(sessionId, jobId)) return;
    updateLocalSession(sessionId, {
      voiceover_status: null,
      voiceover_error: null,
      voiceover_audio_path: null,
    });
    return;
  }

  if (!session.subtitles_content?.trim()) {
    updateLocalSession(sessionId, {
      subtitles_content: subtitles,
    });
  }

  const captions = buildTimedCaptions(parseSRT(subtitles));
  if (captions.length === 0) {
    if (!isCurrentJob(sessionId, jobId)) return;
    updateLocalSession(sessionId, {
      voiceover_status: null,
      voiceover_error: null,
      voiceover_audio_path: null,
    });
    return;
  }

  const tempDir = path.join(artifactsDir, `voiceover_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const syncedAudioPath = path.join(artifactsDir, "voiceover.m4a");
  const muxedVideoPath = path.join(tempDir, "video_voiced.mp4");

  await fsp.mkdir(tempDir, { recursive: true });

  try {
    const segments = await generateCaptionBatch(
      captions,
      config.apiKey,
      selectedVoiceId,
      tempDir
    );
    if (!isCurrentJob(sessionId, jobId)) return;
    await buildSyncedAudioTrack(segments, syncedAudioPath);
    if (!isCurrentJob(sessionId, jobId)) return;
    await muxVideoWithAudio(videoPath, syncedAudioPath, muxedVideoPath);
    if (!isCurrentJob(sessionId, jobId)) return;

    const latestVideoStat = await fsp.stat(videoPath).catch(() => null);
    const sourceChanged = Boolean(
      sourceVideoStat &&
        latestVideoStat &&
        (latestVideoStat.mtimeMs !== sourceVideoStat.mtimeMs ||
          latestVideoStat.size !== sourceVideoStat.size)
    );
    if (sourceChanged) {
      if (isCurrentJob(sessionId, jobId)) {
        updateLocalSession(sessionId, {
          voiceover_status: null,
          voiceover_error: null,
        });
      }
      return;
    }

    await fsp.copyFile(muxedVideoPath, videoPath);
    if (!isCurrentJob(sessionId, jobId)) return;
    const voicedVideoStat = await fsp.stat(videoPath).catch(() => null);
    const voicedVideoVersion = voicedVideoStat
      ? Math.round(voicedVideoStat.mtimeMs)
      : Date.now();

    updateLocalSession(sessionId, {
      voiceover_status: "completed",
      voiceover_error: null,
      voiceover_audio_path: syncedAudioPath,
      hq_render_status: null,
      hq_render_progress: null,
      last_video_url: localFileToApiUrl(sessionId, videoPath, voicedVideoVersion),
    });
  } catch (error) {
    if (!isCurrentJob(sessionId, jobId)) return;
    const rawMessage = error instanceof Error ? error.message : String(error);
    updateLocalSession(sessionId, {
      voiceover_status: "failed",
      voiceover_error: parseVoiceoverFailure(rawMessage).message,
    });
  } finally {
    await safeRemoveDirectory(tempDir);
  }
}

export async function startLocalVoiceoverJob(
  sessionId: string,
  options: StartVoiceoverOptions = {}
): Promise<StartVoiceoverResult> {
  const session = getLocalSession(sessionId);
  if (!session) {
    return {
      started: false,
      status: 404,
      message: "Session not found",
    };
  }

  const config = getElevenLabsConfig();
  if (!config) {
    if (options.silentIfUnavailable) {
      return {
        started: false,
        status: 204,
        message: "ElevenLabs not configured",
      };
    }
    return {
      started: false,
      status: 503,
      message: "ElevenLabs is not configured",
    };
  }

  if (activeVoiceoverJobs.has(sessionId) && !options.force) {
    return {
      started: false,
      status: 409,
      message: "Voiceover generation already in progress",
    };
  }

  if (!options.force && isVoiceoverInProgress(session.voiceover_status)) {
    return {
      started: false,
      status: 409,
      message: "Voiceover generation already in progress",
    };
  }

  if (!session.video_path) {
    return {
      started: false,
      status: 400,
      message: "No video found for this session",
    };
  }

  updateLocalSession(sessionId, {
    voiceover_status: "pending",
    voiceover_error: null,
  });

  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const promise = Promise.resolve()
    .then(() => runVoiceoverJob(sessionId, jobId))
    .catch((error) => {
      if (!isCurrentJob(sessionId, jobId)) return;
      const rawMessage = error instanceof Error ? error.message : String(error);
      updateLocalSession(sessionId, {
        voiceover_status: "failed",
        voiceover_error: parseVoiceoverFailure(rawMessage).message,
      });
    })
    .finally(() => {
      if (isCurrentJob(sessionId, jobId)) {
        activeVoiceoverJobs.delete(sessionId);
      }
    });

  activeVoiceoverJobs.set(sessionId, {
    id: jobId,
    sessionId,
    startedAt,
    promise,
  });

  void promise;

  return {
    started: true,
    status: 202,
    message: "Voiceover generation started",
  };
}

export function isLocalVoiceoverJobActive(sessionId: string): boolean {
  return activeVoiceoverJobs.has(sessionId);
}

export function getLocalVoiceoverJobStartedAt(sessionId: string): string | null {
  return activeVoiceoverJobs.get(sessionId)?.startedAt || null;
}

export async function clearLocalVoiceoverArtifacts(sessionId: string): Promise<void> {
  const session = getLocalSession(sessionId);
  const { artifactsDir } = ensureLocalSessionLayout(sessionId);

  const audioPath = session?.voiceover_audio_path || path.join(artifactsDir, "voiceover.m4a");
  await safeUnlink(audioPath);
}
