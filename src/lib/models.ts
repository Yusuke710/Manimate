/**
 * Generation options shared by server and client: the logical runtime model
 * (claude | codex) and the video aspect ratio.
 */

interface ModelEntry {
  label: string;
}

export const DEFAULT_MODEL = "claude";

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  claude: {
    label: "Claude",
  },
  codex: {
    label: "Codex",
  },
};

const MODEL_ID_SET = new Set(Object.keys(MODEL_REGISTRY));

export function isRegisteredModelId(modelId: string): boolean {
  return MODEL_ID_SET.has(modelId);
}

export const AVAILABLE_MODELS = Object.entries(MODEL_REGISTRY).map(
  ([id, { label }]) => ({ id, label })
);

export function getModelDisplayLabel(modelId: string): string {
  return MODEL_REGISTRY[modelId]?.label || modelId;
}

export const ASPECT_RATIO_VALUES = ["16:9", "9:16", "1:1"] as const;

export type AspectRatio = (typeof ASPECT_RATIO_VALUES)[number];

export const DEFAULT_ASPECT_RATIO: AspectRatio = "16:9";

export const ASPECT_RATIO_OPTIONS = [
  { id: "16:9", label: "Landscape" },
  { id: "9:16", label: "Reel" },
  { id: "1:1", label: "Square" },
] as const satisfies ReadonlyArray<{ id: AspectRatio; label: string }>;

export function getHqResolution(ratio: AspectRatio): { width: number; height: number } {
  switch (ratio) {
    case "9:16": return { width: 1080, height: 1920 };
    case "1:1":  return { width: 1080, height: 1080 };
    default:     return { width: 1920, height: 1080 }; // 16:9
  }
}

const ASPECT_RATIO_SET = new Set<AspectRatio>(ASPECT_RATIO_VALUES);

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && ASPECT_RATIO_SET.has(value as AspectRatio);
}
