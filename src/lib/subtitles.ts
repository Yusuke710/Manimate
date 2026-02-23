interface SandboxCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SandboxLike {
  commands: {
    run(command: string): Promise<SandboxCommandResult>;
  };
  files: {
    read(filePath: string): Promise<string>;
  };
}

const SRT_TIME_REGEX = /(\d+):(\d+):(\d+)[,.](\d+)/;
const SRT_RANGE_REGEX = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/;
const FALLBACK_MEDIA_ROOT = "/home/user/media";

export function parseConcatFile(content: string): string[] {
  const paths: string[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Accept single-quoted, double-quoted, and unquoted ffmpeg concat entries.
    const match = line.match(/^file\s+(?:(['"])(.*?)\1|(.+?))(?:\s+#.*)?$/);
    if (!match) continue;

    const path = (match[2] ?? match[3] ?? "").trim();
    if (path) {
      paths.push(path);
    }
  }

  return paths;
}

export function parseSrtTime(time: string): number {
  const match = time.match(SRT_TIME_REGEX);
  if (!match) return 0;
  return (
    parseInt(match[1], 10) * 3600 +
    parseInt(match[2], 10) * 60 +
    parseInt(match[3], 10) +
    parseInt(match[4], 10) / 1000
  );
}

export function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

export async function getMediaDuration(
  sandbox: SandboxLike,
  mediaPath: string
): Promise<number> {
  try {
    const result = await sandbox.commands.run(
      `ffprobe -v quiet -print_format json -show_format "${mediaPath}"`
    );
    if (result.exitCode === 0 && result.stdout) {
      const data = JSON.parse(result.stdout);
      return parseFloat(data.format?.duration || "0");
    }
  } catch {
    // Ignore and return 0.
  }
  return 0;
}

function toAbsoluteVideoPath(projectPath: string, videoPath: string): string {
  return videoPath.startsWith("/") ? videoPath : `${projectPath}/${videoPath}`;
}

function toProjectRelativePath(projectPath: string, absolutePath: string): string {
  const prefix = `${projectPath}/`;
  return absolutePath.startsWith(prefix)
    ? absolutePath.slice(prefix.length)
    : absolutePath;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeFrameRateToken(rawValue: string): string {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return rawValue;
  if (Number.isInteger(numeric)) return String(Math.trunc(numeric));
  return String(numeric).replace(/\.?0+$/, "");
}

function uniqueSorted(paths: string[]): string[] {
  return Array.from(new Set(paths)).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}

async function readTextFileIfExists(
  sandbox: SandboxLike,
  path: string
): Promise<string | null> {
  try {
    return await sandbox.files.read(path);
  } catch {
    return null;
  }
}

async function fileExists(
  sandbox: SandboxLike,
  absolutePath: string
): Promise<boolean> {
  try {
    const result = await sandbox.commands.run(`test -f ${shellQuote(absolutePath)}`);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function filterExistingSceneVideos(
  sandbox: SandboxLike,
  projectPath: string,
  videoPaths: string[]
): Promise<string[]> {
  const checks = await Promise.all(
    videoPaths.map(async (videoPath) => {
      const absolutePath = toAbsoluteVideoPath(projectPath, videoPath);
      return (await fileExists(sandbox, absolutePath)) ? videoPath : null;
    })
  );

  return checks.filter((path): path is string => Boolean(path));
}

async function inferRenderSubdirFromScript(
  sandbox: SandboxLike,
  projectPath: string
): Promise<string | null> {
  const scriptContent = await readTextFileIfExists(sandbox, `${projectPath}/script.py`);
  if (!scriptContent) return null;

  const pixelHeightMatch = scriptContent.match(/config\.pixel_height\s*=\s*(\d+)/);
  const frameRateMatch = scriptContent.match(
    /config\.frame_rate\s*=\s*([0-9]+(?:\.[0-9]+)?)/
  );

  if (!pixelHeightMatch || !frameRateMatch) return null;

  const frameRateToken = normalizeFrameRateToken(frameRateMatch[1]);
  return `${pixelHeightMatch[1]}p${frameRateToken}`;
}

async function scanSceneVideosByRenderSubdir(
  sandbox: SandboxLike,
  projectPath: string,
  renderSubdir: string
): Promise<string[]> {
  try {
    const result = await sandbox.commands.run(
      `find "${projectPath}/media/videos" "${FALLBACK_MEDIA_ROOT}/videos" -type f -path "*/${renderSubdir}/*.mp4" 2>/dev/null | grep -v "partial_movie_files" | grep -v "/video.mp4$" | sort`
    );
    if (result.exitCode === 0 && result.stdout) {
      const paths = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((absolutePath) => toProjectRelativePath(projectPath, absolutePath));

      if (paths.length > 0) {
        return uniqueSorted(paths);
      }
    }
  } catch {
    // Fall through and return empty.
  }

  return [];
}

export async function scanForSceneVideos(
  sandbox: SandboxLike,
  projectPath: string
): Promise<string[]> {
  const renderSubdir = await inferRenderSubdirFromScript(sandbox, projectPath);
  if (renderSubdir) {
    const deterministicPaths = await scanSceneVideosByRenderSubdir(
      sandbox,
      projectPath,
      renderSubdir
    );
    if (deterministicPaths.length > 0) {
      return deterministicPaths;
    }
  }

  try {
    const result = await sandbox.commands.run(
      `find "${projectPath}/media" "${FALLBACK_MEDIA_ROOT}" -type f -name "*.mp4" -printf "%T@ %p\\n" 2>/dev/null | grep -v "partial_movie_files" | grep -v "/video.mp4$" | sort -nr`
    );
    if (result.exitCode === 0 && result.stdout) {
      const timedPaths = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const splitIndex = line.indexOf(" ");
          if (splitIndex <= 0) return null;
          const absolutePath = line.slice(splitIndex + 1).trim();
          return absolutePath || null;
        })
        .filter((path): path is string => Boolean(path));

      if (timedPaths.length > 0) {
        const newestDir = parentDirectory(timedPaths[0]);
        const newestDirPaths = timedPaths
          .filter((path) => parentDirectory(path) === newestDir)
          .map((absolutePath) => toProjectRelativePath(projectPath, absolutePath));

        if (newestDirPaths.length > 0) {
          return uniqueSorted(newestDirPaths);
        }
      }
    }
  } catch {
    // Fall through and return empty.
  }

  // Legacy fallback when timestamp scan fails.
  try {
    const fallback = await sandbox.commands.run(
      `find "${projectPath}/media" -name "*.mp4" -type f 2>/dev/null | grep -v "partial_movie_files" | grep -v "/video.mp4$" | sort`
    );
    if (fallback.exitCode === 0 && fallback.stdout) {
      return fallback.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((absolutePath) => toProjectRelativePath(projectPath, absolutePath));
    }
  } catch {
    // Fall through and return empty.
  }

  return [];
}

export async function getSceneVideoPaths(
  sandbox: SandboxLike,
  projectPath: string
): Promise<string[]> {
  try {
    const concatContent = await sandbox.files.read(`${projectPath}/concat.txt`);
    const parsed = parseConcatFile(concatContent);
    if (parsed.length > 0) {
      const existingParsed = await filterExistingSceneVideos(
        sandbox,
        projectPath,
        parsed
      );

      if (existingParsed.length === parsed.length) {
        return parsed;
      }

      console.warn(
        `[subtitles] concat.txt listed ${parsed.length} scene file(s), but ${parsed.length - existingParsed.length} were missing; falling back to media scan`
      );
    }
  } catch {
    // concat.txt not found, fall back to scan.
  }

  return scanForSceneVideos(sandbox, projectPath);
}

export interface SubtitleLookupContext {
  videoPath: string;
  absoluteVideoPath: string;
  defaultSrtPath: string;
  sandbox: SandboxLike;
}

export interface SubtitleConcatOptions {
  includeTrailingNewline?: boolean;
  videoPaths?: string[];
  resolveSubtitleContent?: (
    context: SubtitleLookupContext
  ) => Promise<string | null>;
  onMissingSubtitle?: (context: SubtitleLookupContext) => void;
}

export interface SubtitleConcatResult {
  content: string | null;
  videoPaths: string[];
  entryCount: number;
}

export async function concatenateSubtitlesForProject(
  sandbox: SandboxLike,
  projectPath: string,
  options: SubtitleConcatOptions = {}
): Promise<SubtitleConcatResult> {
  const {
    includeTrailingNewline = true,
    resolveSubtitleContent,
    onMissingSubtitle,
  } = options;
  const videoPaths = options.videoPaths || (await getSceneVideoPaths(sandbox, projectPath));

  if (videoPaths.length === 0) {
    return { content: null, videoPaths: [], entryCount: 0 };
  }

  const entries: string[] = [];
  let offset = 0;
  let entryIndex = 1;

  for (const videoPath of videoPaths) {
    const absoluteVideoPath = toAbsoluteVideoPath(projectPath, videoPath);
    const defaultSrtPath = absoluteVideoPath.replace(/\.mp4$/, ".srt");
    const context: SubtitleLookupContext = {
      videoPath,
      absoluteVideoPath,
      defaultSrtPath,
      sandbox,
    };

    let srtContent = await readTextFileIfExists(sandbox, defaultSrtPath);
    if (!srtContent && resolveSubtitleContent) {
      srtContent = await resolveSubtitleContent(context);
    }

    if (!srtContent) {
      if (onMissingSubtitle) {
        onMissingSubtitle(context);
      }
    } else if (srtContent.trim()) {
      const blocks = srtContent.trim().split(/\n\n+/);
      for (const block of blocks) {
        const lines = block.split("\n");
        if (lines.length < 2) continue;

        let timeLineIndex = 0;
        let timeMatch = lines[timeLineIndex]?.match(SRT_RANGE_REGEX);
        if (!timeMatch && lines.length > 1) {
          timeLineIndex = 1;
          timeMatch = lines[timeLineIndex]?.match(SRT_RANGE_REGEX);
        }
        if (!timeMatch) continue;

        const startTime = parseSrtTime(timeMatch[1]) + offset;
        const endTime = parseSrtTime(timeMatch[2]) + offset;
        const text = lines.slice(timeLineIndex + 1).join("\n");
        if (!text.trim()) continue;

        entries.push(
          `${entryIndex}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${text}`
        );
        entryIndex++;
      }
    }

    const duration = await getMediaDuration(sandbox, absoluteVideoPath);
    offset += duration;
  }

  if (entries.length === 0) {
    return { content: null, videoPaths, entryCount: 0 };
  }

  const body = entries.join("\n\n");
  return {
    content: includeTrailingNewline ? `${body}\n` : body,
    videoPaths,
    entryCount: entries.length,
  };
}
