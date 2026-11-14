/** Buffer incomplete lines; ignore non-JSON CLI output and primitive values. */
export function parseNDJSONChunk(buffer: string, chunk: string): {
  lines: object[];
  remainder: string;
} {
  const parts = (buffer + chunk).split("\n");
  const remainder = parts.pop()!;
  const lines: object[] = [];
  for (const line of parts) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object") lines.push(parsed);
    } catch { /* CLIs can mix diagnostics with JSON events. */ }
  }
  return { lines, remainder };
}
