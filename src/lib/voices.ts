/**
 * Voice Registry
 *
 * Available TTS voices. Voice is selected per session
 * and persisted in the sessions table.
 */

interface VoiceEntry {
  label: string;
  description: string;
  provider: "kokoro" | "elevenlabs";
  /** Voice name used for preview/search URL when available. */
  name: string;
}

export const VOICE_REGISTRY: Record<string, VoiceEntry> = {
  af_heart: {
    label: "Heart",
    description: "Kokoro local voice, free",
    provider: "kokoro",
    name: "af_heart",
  },
  "Lci8YeL6PAFHJjNKvwXq": {
    label: "Yusuke",
    description: "ElevenLabs legacy, Japanese accent",
    provider: "elevenlabs",
    name: "Yusuke",
  },
  "TX3LPaxmHKxFdv7VOQHJ": {
    label: "Liam",
    description: "ElevenLabs legacy, young male",
    provider: "elevenlabs",
    name: "Liam",
  },
};

export const DEFAULT_VOICE_ID = "af_heart";

export const NONE_VOICE_ID = "none";

export const VOICE_ID_PATTERN = /^(?:[a-z]{1,2}_[a-z0-9_]{2,64}|[a-zA-Z0-9]{8,64})$/;

export const AVAILABLE_VOICES = Object.entries(VOICE_REGISTRY).map(
  ([id, { label, description, provider }]) => ({ id, label, description, provider })
);

/** ElevenLabs Default Voices page filtered by voice name */
export function getVoicePageUrl(voiceId: string): string {
  const entry = VOICE_REGISTRY[voiceId];
  if (entry?.provider === "kokoro") {
    return "https://huggingface.co/hexgrad/Kokoro-82M";
  }
  if (entry?.provider === "elevenlabs") {
    return `https://elevenlabs.io/app/default-voices?search=${encodeURIComponent(entry.name)}`;
  }
  return "https://elevenlabs.io/app/default-voices";
}

/** Get display label for a voice ID. Returns label from registry or null for unknown IDs. */
export function getVoiceLabel(voiceId: string): string | null {
  return VOICE_REGISTRY[voiceId]?.label ?? null;
}

export function isValidVoiceId(voiceId: string): boolean {
  return voiceId === NONE_VOICE_ID || VOICE_ID_PATTERN.test(voiceId);
}
