/** Kokoro voices, selected per session and stored in session.json. */
export const DEFAULT_VOICE_ID = "af_heart";
export const NONE_VOICE_ID = "none";
export const VOICE_ID_PATTERN = /^[a-z]{1,2}_[a-z0-9_]{2,64}$/;
export const AVAILABLE_VOICES = [
  { id: DEFAULT_VOICE_ID, label: "Heart", description: "Kokoro voice, free" },
];

export function isValidVoiceId(voiceId: string): boolean {
  return voiceId === NONE_VOICE_ID || VOICE_ID_PATTERN.test(voiceId);
}
