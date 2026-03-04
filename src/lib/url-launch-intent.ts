import { isAspectRatio, type AspectRatio } from "@/lib/aspect-ratio";
import { isRegisteredModelId } from "@/lib/models";
import { isValidVoiceId } from "@/lib/voices";

export interface UrlLaunchIntent {
  prompt: string;
  autoSend: boolean;
  model?: string;
  voiceId?: string;
  aspectRatio?: AspectRatio;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function parseTruthy(value: string | null): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function sanitizePrompt(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseUrlLaunchIntent(search: string): UrlLaunchIntent | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return null;

  const params = new URLSearchParams(query);
  const prompt = sanitizePrompt(params.get("prompt") ?? params.get("q"));
  if (!prompt) return null;

  const intent: UrlLaunchIntent = {
    prompt,
    autoSend: parseTruthy(params.get("send")),
  };

  const modelParam = params.get("model")?.trim();
  if (modelParam && isRegisteredModelId(modelParam)) {
    intent.model = modelParam;
  }

  const voiceParam = (params.get("voice_id") ?? params.get("voice"))?.trim();
  if (voiceParam && isValidVoiceId(voiceParam)) {
    intent.voiceId = voiceParam;
  }

  const ratioParam = (params.get("aspect_ratio") ?? params.get("aspectRatio"))?.trim();
  if (isAspectRatio(ratioParam)) {
    intent.aspectRatio = ratioParam;
  }

  return intent;
}
