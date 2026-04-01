import { readStoredLocalConfig, updateStoredLocalConfig } from "@/lib/local/local-config-store";

const ELEVENLABS_API_KEY_FIELD = "elevenlabs_api_key";
const MAX_API_KEY_LENGTH = 1024;

export type ElevenLabsApiKeySource = "saved" | "env";

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_API_KEY_LENGTH) return null;
  return trimmed;
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`;
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function getSavedElevenLabsApiKey(): string | null {
  const config = readStoredLocalConfig();
  return normalizeApiKey(config[ELEVENLABS_API_KEY_FIELD]);
}

export function writeSavedElevenLabsApiKey(apiKey: string): string {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    throw new Error("ElevenLabs API key is required");
  }

  updateStoredLocalConfig((current) => ({
    ...current,
    [ELEVENLABS_API_KEY_FIELD]: normalized,
  }));

  return normalized;
}

export function clearSavedElevenLabsApiKey(): void {
  updateStoredLocalConfig((current) => {
    const next = { ...current };
    delete next[ELEVENLABS_API_KEY_FIELD];
    return next;
  });
}

export function getResolvedElevenLabsApiKey(
  sourceEnv: NodeJS.ProcessEnv = process.env
): { apiKey: string | null; source: ElevenLabsApiKeySource | null } {
  const saved = getSavedElevenLabsApiKey();
  if (saved) {
    return { apiKey: saved, source: "saved" };
  }

  const envApiKey = normalizeApiKey(sourceEnv.ELEVENLABS_API_KEY);
  if (envApiKey) {
    return { apiKey: envApiKey, source: "env" };
  }

  return { apiKey: null, source: null };
}

export function getElevenLabsApiKeyStatus(
  sourceEnv: NodeJS.ProcessEnv = process.env
): {
  configured: boolean;
  source: ElevenLabsApiKeySource | null;
  maskedKey: string | null;
} {
  const resolved = getResolvedElevenLabsApiKey(sourceEnv);
  return {
    configured: Boolean(resolved.apiKey),
    source: resolved.source,
    maskedKey: resolved.apiKey ? maskApiKey(resolved.apiKey) : null,
  };
}
