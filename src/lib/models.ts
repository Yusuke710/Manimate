/**
 * Local model registry (single-provider local runtime).
 */

interface ModelEntry {
  label: string;
  description: string;
}

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  opus: {
    label: "Opus 4.6",
    description: "Most capable for complex work",
  },
  sonnet: {
    label: "Sonnet 4.5",
    description: "Best for everyday tasks",
  },
  haiku: {
    label: "Haiku 4.5",
    description: "Fastest for quick answers",
  },
};

export const DEFAULT_MODEL = "opus";

const MODEL_ID_SET = new Set(Object.keys(MODEL_REGISTRY));

export function isRegisteredModelId(modelId: string): boolean {
  return MODEL_ID_SET.has(modelId);
}

export const AVAILABLE_MODELS = Object.entries(MODEL_REGISTRY).map(
  ([id, { label, description }]) => ({ id, label, description })
);

export function getModelDisplayLabel(modelId: string): string {
  return MODEL_REGISTRY[modelId]?.label || modelId;
}
