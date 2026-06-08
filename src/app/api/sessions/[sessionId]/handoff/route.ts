/**
 * Local Session Handoff API
 *
 * POST /api/sessions/[sessionId]/handoff - Create a new session with the latest
 * plan.md, script.py, and rendered video from the source session.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
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

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

function stripHandoffPrefix(title: string): string {
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
  const targetStat = await fsp.stat(targetPath);

  return {
    path: targetPath,
    url: localFileToApiUrl(
      path.basename(path.dirname(options.targetProjectDir)),
      targetPath,
      Math.round(targetStat.mtimeMs),
    ),
  };
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { sessionId } = await context.params;
  const sourceSession = getLocalSession(sessionId);

  if (!sourceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const sourcePaths = ensureLocalSessionLayout(sourceSession.id);
    const handoffSession = createLocalSession({
      model: sourceSession.model,
      aspect_ratio: sourceSession.aspect_ratio,
      voice_id: sourceSession.voice_id,
    });
    const targetPaths = ensureLocalSessionLayout(handoffSession.id);

    const [planContent, scriptContent, videoArtifact] = await Promise.all([
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
      chapters,
      ...(videoArtifact
        ? {
            video_path: videoArtifact.path,
            last_video_url: videoArtifact.url,
          }
        : {}),
    });

    const nextSession = getLocalSession(handoffSession.id) ?? handoffSession;
    return NextResponse.json({
      session: nextSession,
      included: {
        plan: Boolean(planContent),
        code: Boolean(scriptContent),
        video: Boolean(videoArtifact),
        chapters: Boolean(chapters),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create handoff";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
