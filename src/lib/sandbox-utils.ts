/**
 * Sandbox Utility Functions
 *
 * Lightweight utilities for sandbox path handling.
 * Client-safe module with no server dependencies.
 */

/**
 * Sanitizes an ID to be safe for use in file paths
 * - Removes any characters that could be used for path traversal
 * - Only allows alphanumeric, hyphens, and underscores
 */
export function sanitizePathId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Returns the project directory path for a given sandbox ID
 * @throws Error if sandboxId is empty or undefined
 */
export function getProjectPath(sandboxId: string): string {
  if (!sandboxId) {
    throw new Error("sandboxId is required for getProjectPath");
  }
  return `/home/user/${sanitizePathId(sandboxId)}`;
}
