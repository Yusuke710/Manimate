import fsp from "node:fs/promises";
import path from "node:path";
import {
  ensureLocalSessionLayout,
  localFileToApiUrl,
} from "@/lib/local/config";
import {
  createLocalSession,
  findLocalSessionWithChaptersByTitle,
  getLocalSession,
  type LocalSession,
  updateLocalSession,
} from "@/lib/local/db";
import {
  readLocalProjectChapters,
  serializeLocalChapters,
} from "@/lib/local/chapters";
import { DEFAULT_MODEL } from "@/lib/models";

export type HandoffIncluded = {
  plan: boolean;
  code: boolean;
  video: boolean;
  chapters: boolean;
};

export type HandoffResult = {
  session: LocalSession;
  included: HandoffIncluded;
};

export type SharedHandoffSnapshot = {
  token?: string;
  title?: string | null;
  planContent?: string | null;
  scriptContent?: string | null;
  subtitlesContent?: string | null;
  chapters?: unknown;
  model?: string | null;
  voiceId?: string | null;
  aspectRatio?: string | null;
  videoUrl?: string | null;
};

export function stripHandoffPrefix(title: string): string {
  return title.replace(/^(Handoff:\s*)+/i, "").trim();
}

async function resolveHandoffChapters(
  sourceSession: LocalSession,
  sourceProjectDir: string,
): Promise<string | null> {
  if (sourceSession.chapters) return sourceSession.chapters;

  const projectChapters = serializeLocalChapters(
    await readLocalProjectChapters(sourceProjectDir),
  );
  if (projectChapters) return projectChapters;

  const originalTitle = stripHandoffPrefix(sourceSession.title);
  if (!originalTitle || originalTitle === sourceSession.title) return null;

  return findLocalSessionWithChaptersByTitle(originalTitle)?.chapters ?? null;
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function normalizeChapters(chapters: unknown): string | null {
  if (typeof chapters === "string") {
    return chapters.trim() ? chapters : null;
  }
  if (chapters === null || chapters === undefined) return null;
  try {
    return JSON.stringify(chapters);
  } catch {
    return null;
  }
}

async function copyTextArtifact(options: {
  sourcePath: string;
  targetPath: string;
  fallbackContent: string | null;
}): Promise<string | null> {
  const content =
    (await readTextFileIfExists(options.sourcePath)) ??
    options.fallbackContent;
  if (content === null) return null;
  await fsp.writeFile(options.targetPath, content, "utf8");
  return content;
}

async function writeTextArtifact(options: {
  targetPath: string;
  content: string | null;
}): Promise<string | null> {
  if (options.content === null) return null;
  await fsp.writeFile(options.targetPath, options.content, "utf8");
  return options.content;
}

async function copyVideoArtifact(options: {
  sourceVideoPath: string | null;
  targetProjectDir: string;
}): Promise<{ path: string; url: string } | null> {
  if (!options.sourceVideoPath) return null;

  const sourceStat = await fsp.stat(options.sourceVideoPath).catch(() => null);
  if (!sourceStat?.isFile()) return null;

  const extension = path.extname(options.sourceVideoPath) || ".mp4";
  const targetPath = path.join(options.targetProjectDir, `video${extension}`);
  await fsp.copyFile(options.sourceVideoPath, targetPath);
  return buildVideoArtifact(path.basename(path.dirname(options.targetProjectDir)), targetPath);
}

async function writeVideoArtifact(options: {
  videoBytes: Uint8Array | null;
  targetProjectDir: string;
  extension?: string;
}): Promise<{ path: string; url: string } | null> {
  if (!options.videoBytes) return null;
  const extension = options.extension?.startsWith(".")
    ? options.extension
    : ".mp4";
  const targetPath = path.join(options.targetProjectDir, `video${extension}`);
  await fsp.writeFile(targetPath, options.videoBytes);
  return buildVideoArtifact(path.basename(path.dirname(options.targetProjectDir)), targetPath);
}

async function buildVideoArtifact(
  sessionId: string,
  targetPath: string,
): Promise<{ path: string; url: string }> {
  const targetStat = await fsp.stat(targetPath);
  return {
    path: targetPath,
    url: localFileToApiUrl(
      sessionId,
      targetPath,
      Math.round(targetStat.mtimeMs),
    ),
  };
}

async function fetchVideoBytes(videoUrl: string | null | undefined): Promise<Uint8Array | null> {
  if (!videoUrl) return null;
  const response = await fetch(videoUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to download shared video");
  }
  return new Uint8Array(await response.arrayBuffer());
}

function getVideoExtension(videoUrl: string | null | undefined): string {
  if (!videoUrl) return ".mp4";
  try {
    const extension = path.extname(new URL(videoUrl).pathname);
    return extension || ".mp4";
  } catch {
    return ".mp4";
  }
}

export async function createHandoffFromLocalSession(
  sourceSession: LocalSession,
): Promise<HandoffResult> {
  const sourcePaths = ensureLocalSessionLayout(sourceSession.id);
  const handoffSession = createLocalSession({
    model: sourceSession.model,
    aspect_ratio: sourceSession.aspect_ratio,
    voice_id: sourceSession.voice_id,
  });
  const targetPaths = ensureLocalSessionLayout(handoffSession.id, {
    model: handoffSession.model,
  });

  const [planContent, scriptContent, subtitlesContent, videoArtifact] = await Promise.all([
    copyTextArtifact({
      sourcePath: path.join(sourcePaths.projectDir, "plan.md"),
      targetPath: path.join(targetPaths.projectDir, "plan.md"),
      fallbackContent: sourceSession.plan_content,
    }),
    copyTextArtifact({
      sourcePath: path.join(sourcePaths.projectDir, "script.py"),
      targetPath: path.join(targetPaths.projectDir, "script.py"),
      fallbackContent: sourceSession.script_content,
    }),
    copyTextArtifact({
      sourcePath: path.join(sourcePaths.projectDir, "subtitles.srt"),
      targetPath: path.join(targetPaths.projectDir, "subtitles.srt"),
      fallbackContent: sourceSession.subtitles_content,
    }),
    copyVideoArtifact({
      sourceVideoPath: sourceSession.video_path,
      targetProjectDir: targetPaths.projectDir,
    }),
  ]);
  const title = `Handoff: ${stripHandoffPrefix(sourceSession.title)}`;
  const chapters = await resolveHandoffChapters(
    sourceSession,
    sourcePaths.projectDir,
  );

  updateLocalSession(handoffSession.id, {
    title,
    plan_content: planContent,
    script_content: scriptContent,
    subtitles_content: subtitlesContent,
    chapters,
    ...(videoArtifact
      ? {
          video_path: videoArtifact.path,
          last_video_url: videoArtifact.url,
        }
      : {}),
  });

  const nextSession = getLocalSession(handoffSession.id) ?? handoffSession;
  return {
    session: nextSession,
    included: {
      plan: Boolean(planContent),
      code: Boolean(scriptContent),
      video: Boolean(videoArtifact),
      chapters: Boolean(chapters),
    },
  };
}

export async function createHandoffFromSharedSnapshot(
  snapshot: SharedHandoffSnapshot,
): Promise<HandoffResult> {
  const videoBytes = await fetchVideoBytes(snapshot.videoUrl);
  const handoffSession = createLocalSession({
    model: snapshot.model || DEFAULT_MODEL,
    aspect_ratio: snapshot.aspectRatio || null,
    voice_id: snapshot.voiceId || null,
  });
  const targetPaths = ensureLocalSessionLayout(handoffSession.id, {
    model: handoffSession.model,
  });

  const [planContent, scriptContent, subtitlesContent, videoArtifact] = await Promise.all([
    writeTextArtifact({
      targetPath: path.join(targetPaths.projectDir, "plan.md"),
      content: snapshot.planContent ?? null,
    }),
    writeTextArtifact({
      targetPath: path.join(targetPaths.projectDir, "script.py"),
      content: snapshot.scriptContent ?? null,
    }),
    writeTextArtifact({
      targetPath: path.join(targetPaths.projectDir, "subtitles.srt"),
      content: snapshot.subtitlesContent ?? null,
    }),
    writeVideoArtifact({
      videoBytes,
      targetProjectDir: targetPaths.projectDir,
      extension: getVideoExtension(snapshot.videoUrl),
    }),
  ]);
  const sourceTitle = snapshot.title?.trim() || "Shared session";
  const chapters = normalizeChapters(snapshot.chapters);

  updateLocalSession(handoffSession.id, {
    title: `Handoff: ${stripHandoffPrefix(sourceTitle)}`,
    plan_content: planContent,
    script_content: scriptContent,
    subtitles_content: subtitlesContent,
    chapters,
    ...(videoArtifact
      ? {
          video_path: videoArtifact.path,
          last_video_url: videoArtifact.url,
        }
      : {}),
  });

  const nextSession = getLocalSession(handoffSession.id) ?? handoffSession;
  return {
    session: nextSession,
    included: {
      plan: Boolean(planContent),
      code: Boolean(scriptContent),
      video: Boolean(videoArtifact),
      chapters: Boolean(chapters),
    },
  };
}
