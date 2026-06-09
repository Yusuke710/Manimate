/**
 * Local runtime identity. Model choice is inherited from Claude Code.
 */

interface ModelEntry {
  label: string;
  description: string;
}

export const DEFAULT_MODEL = "claude";

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  claude: {
    label: "Claude",
    description: "Uses your configured Claude Code model",
  },
};

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
