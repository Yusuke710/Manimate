/**
 * NDJSON (Newline Delimited JSON) parser with line buffering
 *
 * Handles TCP chunking where JSON lines may be split across multiple chunks.
 * Accumulates incomplete lines and only parses complete lines ending with newline.
 */

export interface ParseResult {
  /** Successfully parsed JSON objects from complete lines */
  lines: object[];
  /** Incomplete line remainder to carry to the next chunk */
  remainder: string;
}

/**
 * Parses NDJSON data from a chunk, handling incomplete lines.
 *
 * @param buffer - Previously buffered incomplete line (remainder from last chunk)
 * @param chunk - New data chunk from stdout
 * @returns Object containing parsed lines and any incomplete remainder
 *
 * @example
 * let buffer = "";
 *
 * onStdout((chunk) => {
 *   const result = parseNDJSONChunk(buffer, chunk);
 *   buffer = result.remainder;
 *   for (const obj of result.lines) {
 *     // Process complete JSON objects
 *   }
 * });
 */
export function parseNDJSONChunk(buffer: string, chunk: string): ParseResult {
  const combined = buffer + chunk;
  const lines: object[] = [];

  // Find the last newline to determine complete vs incomplete content
  const lastNewlineIndex = combined.lastIndexOf('\n');

  if (lastNewlineIndex === -1) {
    // No complete lines yet - entire combined string is a partial line
    return { lines: [], remainder: combined };
  }

  // Split into complete content and remainder
  const completeContent = combined.substring(0, lastNewlineIndex);
  const remainder = combined.substring(lastNewlineIndex + 1);

  // Parse each complete line
  const rawLines = completeContent.split('\n');
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      // Skip empty lines
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      // Only include objects/arrays, skip primitives
      if (parsed !== null && typeof parsed === 'object') {
        lines.push(parsed);
      }
    } catch {
      // Invalid JSON line - skip silently
      // This handles cases like:
      // - Non-JSON output mixed in the stream
      // - Corrupted/malformed JSON
      // We log nothing here to avoid noise, but the line is dropped
    }
  }

  return { lines, remainder };
}
