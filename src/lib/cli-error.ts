/**
 * Transform raw Claude Code CLI error output into a human-readable message.
 *
 * The CLI with --output-format stream-json emits NDJSON lines. On failure the
 * last line is a `{"type":"result", ...}` object. We scan for it, parse it,
 * and map known subtypes to user-friendly messages.
 */
export function transformCliError(exitCode: number, rawDetails: string, stderr?: string): string {
  // Try to find and parse a result JSON object.
  // Input may be a single JSON string, or NDJSON with the result as the last line.
  const result = extractResult(rawDetails);
  if (result) {
    const subtype = result.subtype as string | undefined;
    if (subtype === "error_during_execution") {
      if (Number(result.permission_denial_count ?? 0) > 0) {
        return "The AI agent encountered a permission error and couldn't complete the task. This is usually temporary — please try again.";
      }
      // Extract useful context from stderr (e.g. Python tracebacks, manim errors)
      const hint = extractErrorHint(stderr || rawDetails);
      const turns = Number(result.num_turns ?? 0);
      const turnsInfo = turns > 0 ? ` after ${turns} step${turns > 1 ? "s" : ""}` : "";
      return hint
        ? `The AI agent encountered an error${turnsInfo}: ${hint}`
        : `The AI agent encountered an error during execution${turnsInfo}. Please try again.`;
    }
    if (subtype === "error_max_turns") {
      const turns = Number(result.num_turns ?? 0);
      const turnsInfo = turns > 0 ? ` after ${turns} step${turns > 1 ? "s" : ""}` : "";
      return `The AI agent reached its maximum number of steps${turnsInfo}. Try breaking your request into smaller tasks.`;
    }
    if (subtype === "error_model") {
      return "Failed to connect to the AI model. This is usually temporary — please try again in a moment.";
    }
  }

  // Check for common patterns in non-JSON error output (case-insensitive)
  const claudeSetupMessage = normalizeClaudeCliSetupError(stderr || rawDetails);
  if (claudeSetupMessage) {
    return claudeSetupMessage;
  }

  const lower = rawDetails.toLowerCase();
  if (lower.includes("anthropic_api_key") || lower.includes("api key") || lower.includes("api_key")) {
    return "AI service configuration error. Please try again or contact support.";
  }
  if (lower.includes("rate limit") || lower.includes("rate_limit") || lower.includes("429") || lower.includes("too many requests")) {
    return "The AI service is temporarily busy. Please wait a moment and try again.";
  }

  // Fallback: truncate raw output, strip JSON noise
  const clean = rawDetails.replace(/\{[^}]{0,500}\}/g, "[...]").trim();
  return `Execution failed (exit code ${exitCode}): ${(clean || rawDetails).slice(0, 200)}`;
}

export function normalizeClaudeCliSetupError(text: string): string | null {
  if (!text) return null;

  const lower = text.toLowerCase();

  if (
    lower.includes("spawn claude enoent") ||
    lower.includes("command not found: claude") ||
    lower.includes("no such file or directory") && lower.includes("claude")
  ) {
    return "Claude Code CLI (`claude`) is not installed. Install it, then run `claude` locally and sign in.";
  }

  if (
    lower.includes("not authenticated") ||
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("log in") ||
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("signed in")
  ) {
    return "Claude Code CLI is not signed in. Run `claude` locally and sign in, then try again.";
  }

  return null;
}

/**
 * Extract a short, user-readable error hint from stderr or raw output.
 * Looks for Python exceptions, manim errors, and other common patterns.
 */
function extractErrorHint(text: string): string | null {
  if (!text) return null;
  // Python traceback: last "Error:" or "Exception:" line
  const errorLineMatch = text.match(/(?:^|\n)\s*(\w+(?:Error|Exception):\s*.+)/m);
  if (errorLineMatch) {
    return errorLineMatch[1].trim().slice(0, 150);
  }
  // "error:" pattern (case-insensitive)
  const genericErrorMatch = text.match(/(?:^|\n)\s*(error:\s*.+)/im);
  if (genericErrorMatch) {
    return genericErrorMatch[1].trim().slice(0, 150);
  }
  return null;
}

/** Scan NDJSON or single JSON for the result object. */
export function extractResult(raw: string): Record<string, unknown> | null {
  // Fast path: single JSON object
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj?.type === "result") return obj;
    } catch {
      // May be NDJSON — fall through
    }
  }
  // Scan lines in reverse for the result object (it's usually last)
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.type === "result") return obj;
    } catch {
      continue;
    }
  }
  return null;
}
