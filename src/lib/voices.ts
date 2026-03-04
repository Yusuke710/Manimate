/**
 * Voice Registry
 *
 * Available ElevenLabs voices for TTS. Voice is selected per session
 * and persisted in the sessions table.
 *
 * Labels/descriptions from ElevenLabs voice metadata.
 * Only uses voices from the Default Voices list so users can preview them.
 */

interface VoiceEntry {
  label: string;
  description: string;
  /** ElevenLabs voice name (used for Default Voices search URL) */
  name: string;
}

export const VOICE_REGISTRY: Record<string, VoiceEntry> = {
  "Lci8YeL6PAFHJjNKvwXq": { label: "Yusuke", description: "Japanese accent, narration", name: "Yusuke" },
  "TX3LPaxmHKxFdv7VOQHJ": { label: "Liam",   description: "Young male, American",       name: "Liam" },
};

export const DEFAULT_VOICE_ID = "Lci8YeL6PAFHJjNKvwXq";

export const VOICE_ID_PATTERN = /^[a-zA-Z0-9]{8,64}$/;

export const AVAILABLE_VOICES = Object.entries(VOICE_REGISTRY).map(
  ([id, { label, description }]) => ({ id, label, description })
);

/** ElevenLabs Default Voices page filtered by voice name */
export function getVoicePageUrl(voiceId: string): string {
  const entry = VOICE_REGISTRY[voiceId];
  if (entry) {
    return `https://elevenlabs.io/app/default-voices?search=${encodeURIComponent(entry.name)}`;
  }
  return "https://elevenlabs.io/app/default-voices";
}

/** Get display label for a voice ID. Returns label from registry or null for unknown IDs. */
export function getVoiceLabel(voiceId: string): string | null {
  return VOICE_REGISTRY[voiceId]?.label ?? null;
}

export function isValidVoiceId(voiceId: string): boolean {
  return VOICE_ID_PATTERN.test(voiceId);
}
