const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_IMAGES = 12;
const MAX_HISTORY_MESSAGE_CHARS = 1500;

export interface SessionHistoryMessage {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
  created_at: string;
}

export interface RecoveredHistoryImage {
  id: string;
  path: string;
  name: string;
  sandboxPath: string;
  sourceMessageId: string;
}

interface BuildConversationRecoveryContextOptions {
  messages: SessionHistoryMessage[];
  projectPath: string;
  userId: string;
  sessionId: string;
  excludeMessageId?: string | null;
  allowedImagePathPrefixes?: string[];
}

interface ConversationRecoveryContext {
  historyPrompt: string;
  images: RecoveredHistoryImage[];
  historyMessageCount: number;
}

interface ParsedImageMetadata {
  id: string;
  path: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getFileExtension(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match ? match[1] : "png";
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function parseImagesFromMetadata(metadata: unknown): ParsedImageMetadata[] {
  if (!isRecord(metadata)) return [];
  const rawImages = metadata.images;
  if (!Array.isArray(rawImages)) return [];

  const images: ParsedImageMetadata[] = [];
  for (const rawImage of rawImages) {
    if (!isRecord(rawImage)) continue;
    const id = typeof rawImage.id === "string" ? rawImage.id : "";
    const path = typeof rawImage.path === "string" ? rawImage.path : "";
    const name = typeof rawImage.name === "string" ? rawImage.name : "";
    if (!id || !path || !name) continue;
    images.push({ id, path, name });
  }
  return images;
}

function reserveSandboxFileName(
  imageId: string,
  imageName: string,
  usedFileNames: Set<string>
): string {
  const base = sanitizeFilePart(imageId);
  const ext = getFileExtension(imageName);
  let candidate = `${base}.${ext}`;
  let suffix = 2;
  while (usedFileNames.has(candidate)) {
    candidate = `${base}-${suffix}.${ext}`;
    suffix += 1;
  }
  usedFileNames.add(candidate);
  return candidate;
}

/**
 * Rebuilds a concise conversation transcript + image references from persisted messages.
 * Used only when a fresh sandbox must be created and Claude `--resume` cannot recover state.
 */
export function buildConversationRecoveryContext(
  options: BuildConversationRecoveryContextOptions
): ConversationRecoveryContext {
  const {
    messages,
    projectPath,
    userId,
    sessionId,
    excludeMessageId,
    allowedImagePathPrefixes,
  } = options;
  const defaultPrefix = `${userId}/${sessionId}/`;
  const safePrefixes = (
    Array.isArray(allowedImagePathPrefixes) && allowedImagePathPrefixes.length > 0
      ? allowedImagePathPrefixes
      : [defaultPrefix]
  )
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix.length > 0);
  const recentMessages = messages
    .filter((message) => message.id !== excludeMessageId)
    .slice(-MAX_HISTORY_MESSAGES);

  const usedImagePaths = new Set<string>();
  const usedSandboxFileNames = new Set<string>();
  const recoveredImages: RecoveredHistoryImage[] = [];
  const transcriptBlocks: string[] = [];

  for (const message of recentMessages) {
    const text = truncateText(message.content || "", MAX_HISTORY_MESSAGE_CHARS);

    const parsedImages = parseImagesFromMetadata(message.metadata);
    const messageImages: RecoveredHistoryImage[] = [];
    for (const parsed of parsedImages) {
      if (recoveredImages.length >= MAX_HISTORY_IMAGES) {
        break;
      }
      const isAllowedPath = safePrefixes.some((prefix) => parsed.path.startsWith(prefix));
      if (!isAllowedPath || usedImagePaths.has(parsed.path)) {
        continue;
      }
      const sandboxFileName = reserveSandboxFileName(
        parsed.id,
        parsed.name,
        usedSandboxFileNames
      );

      const recovered: RecoveredHistoryImage = {
        id: parsed.id,
        path: parsed.path,
        name: parsed.name,
        sandboxPath: `${projectPath}/inputs/history/${sandboxFileName}`,
        sourceMessageId: message.id,
      };
      usedImagePaths.add(parsed.path);
      recoveredImages.push(recovered);
      messageImages.push(recovered);
    }

    if (!text && messageImages.length === 0) {
      continue;
    }

    const roleLabel = message.role === "assistant" ? "Assistant" : "User";
    const blockLines: string[] = [`${roleLabel}: ${text || "[no text content]"}`];
    if (messageImages.length > 0) {
      blockLines.push(
        `Images: ${messageImages.map((image) => image.sandboxPath).join(", ")}`
      );
    }

    transcriptBlocks.push(`${transcriptBlocks.length + 1}. ${blockLines.join("\n")}`);
  }

  if (transcriptBlocks.length === 0 && recoveredImages.length === 0) {
    return { historyPrompt: "", images: [], historyMessageCount: 0 };
  }

  const imageSummary = recoveredImages.length
    ? `\n\nRecovered images copied from persisted messages:\n${recoveredImages
        .map((image) => `- ${image.sandboxPath} (original: ${image.name})`)
        .join("\n")}`
    : "";

  const historyPrompt = [
    "Recovered conversation context from persisted history because the previous sandbox no longer exists.",
    "Continue from this context instead of restarting from scratch.",
    "",
    transcriptBlocks.join("\n\n"),
    imageSummary,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    historyPrompt,
    images: recoveredImages,
    historyMessageCount: transcriptBlocks.length,
  };
}
