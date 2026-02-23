/**
 * Centralized timeout policy.
 *
 * Keep command timeout and sandbox lifetime coordinated so users can inspect
 * outputs (like rendered videos) after command completion.
 */
export const COMMAND_TIMEOUT_MINUTES = 12;
export const COMMAND_TIMEOUT_MS = COMMAND_TIMEOUT_MINUTES * 60 * 1000;

export const SANDBOX_TIMEOUT_MULTIPLIER = 1.5;
export const DEFAULT_SANDBOX_TIMEOUT_MS = Math.round(
  COMMAND_TIMEOUT_MS * SANDBOX_TIMEOUT_MULTIPLIER
);

