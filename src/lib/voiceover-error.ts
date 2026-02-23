export type VoiceoverFailureKind = "quota_exceeded" | "generic";

export interface VoiceoverFailureInfo {
  kind: VoiceoverFailureKind;
  message: string;
  retryable: boolean;
}

const QUOTA_MESSAGE =
  "ElevenLabs quota exceeded. Check your ElevenLabs plan/quota, then retry.";

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseVoiceoverFailure(error: string | null | undefined): VoiceoverFailureInfo {
  if (!error || !error.trim()) {
    return {
      kind: "generic",
      message: "Audio generation failed. Please retry.",
      retryable: true,
    };
  }

  const trimmed = error.trim();
  const parsed = safeJsonParse(trimmed) as
    | { detail?: { status?: string; message?: string } | string }
    | null;

  const providerStatus =
    parsed && typeof parsed.detail === "object" && parsed.detail
      ? parsed.detail.status
      : null;
  const providerMessage =
    parsed && typeof parsed.detail === "object" && parsed.detail
      ? parsed.detail.message
      : null;

  const looksLikeQuotaExceeded =
    providerStatus === "quota_exceeded" ||
    trimmed.includes("quota_exceeded") ||
    /quota\s+exceeded/i.test(trimmed) ||
    /request\s+exceeds\s+your\s+quota/i.test(trimmed);

  if (looksLikeQuotaExceeded) {
    return {
      kind: "quota_exceeded",
      message: providerMessage && providerMessage.trim() ? providerMessage : QUOTA_MESSAGE,
      retryable: true,
    };
  }

  if (providerMessage && providerMessage.trim()) {
    return {
      kind: "generic",
      message: providerMessage,
      retryable: true,
    };
  }

  return {
    kind: "generic",
    message: trimmed,
    retryable: true,
  };
}
