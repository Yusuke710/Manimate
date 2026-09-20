import fsp from "node:fs/promises";
import path from "node:path";
import { ensureLocalSessionLayout } from "@/lib/local/config";
import {
  createLocalSession,
  findLocalSessionWithChaptersByTitle,
  getLocalSession,
  type LocalSession,
  updateLocalSession,
} from "@/lib/local/session-store";
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

export type HandoffSessionOptions = {
  model?: string;
  voiceId?: string | null;
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

async function copyTextArtifact(options: {
  sourcePath: string;
  targetPath: string;
}): Promise<string | null> {
  const content = await fsp.readFile(options.sourcePath, "utf8").catch(() => null);
  if (content === null) return null;
  await fsp.writeFile(options.targetPath, content, "utf8");
  return content;
}

async function copyVideoArtifact(options: {
  sourceVideoPath: string | null;
  targetProjectDir: string;
}): Promise<string | null> {
  if (!options.sourceVideoPath) return null;

  const sourceStat = await fsp.stat(options.sourceVideoPath).catch(() => null);
  if (!sourceStat?.isFile()) return null;

  const extension = path.extname(options.sourceVideoPath) || ".mp4";
  const targetPath = path.join(options.targetProjectDir, `video${extension}`);
  await fsp.copyFile(options.sourceVideoPath, targetPath);
  return targetPath;
}

export async function createHandoffFromLocalSession(
  sourceSession: LocalSession,
  options: HandoffSessionOptions = {},
): Promise<HandoffResult> {
  const sourcePaths = ensureLocalSessionLayout(sourceSession.id);
  const handoffSession = createLocalSession({
    model: options.model || DEFAULT_MODEL,
    aspect_ratio: sourceSession.aspect_ratio,
    voice_id: options.voiceId ?? null,
  });
  const targetPaths = ensureLocalSessionLayout(handoffSession.id, {
    model: handoffSession.model,
  });

  const [planContent, scriptContent, , videoPath] = await Promise.all([
    copyTextArtifact({
      sourcePath: path.join(sourcePaths.projectDir, "plan.md"),
      targetPath: path.join(targetPaths.projectDir, "plan.md"),
    }),
    copyTextArtifact({
      sourcePath: path.join(sourcePaths.projectDir, "script.py"),
      targetPath: path.join(targetPaths.projectDir, "script.py"),
    }),
    copyTextArtifact({
      sourcePath: path.join(sourcePaths.projectDir, "subtitles.srt"),
      targetPath: path.join(targetPaths.projectDir, "subtitles.srt"),
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
    chapters,
    ...(videoPath ? { video_path: videoPath } : {}),
  });

  const nextSession = getLocalSession(handoffSession.id) ?? handoffSession;
  return {
    session: nextSession,
    included: {
      plan: Boolean(planContent),
      code: Boolean(scriptContent),
      video: Boolean(videoPath),
      chapters: Boolean(chapters),
    },
  };
}
