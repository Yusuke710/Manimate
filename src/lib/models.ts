/**
 * Local model registry (single-provider local runtime).
 */

interface ModelEntry {
  label: string;
  description: string;
}

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  "claude-opus-4-6": {
    label: "Claude Opus 4.6",
    description: "Best quality",
  },
};

export const DEFAULT_MODEL = "claude-opus-4-6";

export const AVAILABLE_MODELS = Object.entries(MODEL_REGISTRY).map(
  ([id, { label, description }]) => ({ id, label, description })
);
