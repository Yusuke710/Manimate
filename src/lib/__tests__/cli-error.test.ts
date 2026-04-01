import { describe, it, expect } from "vitest";
import { normalizeClaudeCliSetupError, transformCliError } from "@/lib/cli-error";

describe("transformCliError", () => {
  it("transforms permission_denial JSON into friendly message", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 0,
      permission_denial_count: 1,
    });
    const msg = transformCliError(1, raw);
    expect(msg).toContain("permission error");
    expect(msg).not.toContain("{");
  });

  it("transforms generic error_during_execution with step count", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 3,
    });
    const msg = transformCliError(1, raw);
    expect(msg).toContain("error during execution");
    expect(msg).toContain("3 steps");
    expect(msg).not.toContain("{");
  });

  it("includes Python error hint from stderr", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 5,
    });
    const stderr = "Traceback (most recent call last):\n  File \"scene.py\", line 42\nValueError: Invalid cubic coefficients";
    const msg = transformCliError(1, raw, stderr);
    expect(msg).toContain("ValueError: Invalid cubic coefficients");
    expect(msg).toContain("5 steps");
  });

  it("includes manim error hint from stderr", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 2,
    });
    const stderr = "some log output\nModuleNotFoundError: No module named 'scipy'\nmore output";
    const msg = transformCliError(1, raw, stderr);
    expect(msg).toContain("ModuleNotFoundError");
  });

  it("transforms error_max_turns", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      num_turns: 50,
    });
    const msg = transformCliError(1, raw);
    expect(msg).toContain("maximum number of steps");
  });

  it("transforms error_model", () => {
    const raw = JSON.stringify({
      type: "result",
      subtype: "error_model",
      is_error: true,
    });
    const msg = transformCliError(1, raw);
    expect(msg).toContain("AI model");
  });

  it("handles API key errors in plain text", () => {
    const msg = transformCliError(1, "Error: ANTHROPIC_API_KEY is not set");
    expect(msg).toContain("configuration error");
  });

  it("handles rate limit errors", () => {
    const msg = transformCliError(1, "Error: 429 Too Many Requests");
    expect(msg).toContain("temporarily busy");
  });

  it("falls back to truncated raw message for unknown errors", () => {
    const msg = transformCliError(1, "Something unexpected happened");
    expect(msg).toContain("exit code 1");
    expect(msg).toContain("Something unexpected happened");
  });

  it("truncates long fallback messages to 200 chars", () => {
    const longError = "x".repeat(500);
    const msg = transformCliError(1, longError);
    expect(msg.length).toBeLessThan(300);
  });

  it("handles malformed JSON gracefully", () => {
    const msg = transformCliError(1, '{"type":"result", broken');
    expect(msg).toContain("exit code 1");
  });

  // NDJSON handling — the CLI outputs stream-json format
  it("extracts result from NDJSON (result as last line)", () => {
    const ndjson = [
      JSON.stringify({ type: "assistant", message: { role: "assistant" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant" } }),
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: 2,
        permission_denial_count: 0,
      }),
    ].join("\n");
    const msg = transformCliError(1, ndjson);
    expect(msg).toContain("error during execution");
    expect(msg).not.toContain("{");
  });

  it("extracts permission_denial from NDJSON result", () => {
    const ndjson = [
      JSON.stringify({ type: "assistant", message: { role: "assistant" } }),
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        permission_denial_count: 3,
      }),
    ].join("\n");
    const msg = transformCliError(1, ndjson);
    expect(msg).toContain("permission error");
  });

  // Case-insensitive pattern matching
  it("handles case-insensitive rate limit errors", () => {
    const msg = transformCliError(1, "Error: Rate Limit exceeded");
    expect(msg).toContain("temporarily busy");
  });

  it("handles 'Too Many Requests' without status code", () => {
    const msg = transformCliError(1, "Error: Too Many Requests");
    expect(msg).toContain("temporarily busy");
  });

  it("maps missing Claude CLI errors", () => {
    const msg = transformCliError(1, "spawn claude ENOENT");
    expect(msg).toContain("Claude Code CLI");
    expect(msg).toContain("run `claude` locally and sign in");
  });

  it("maps signed-out Claude CLI errors", () => {
    const msg = transformCliError(1, "Error: Not authenticated. Please login first.");
    expect(msg).toContain("not signed in");
    expect(msg).toContain("Run `claude` locally and sign in");
  });
});

describe("normalizeClaudeCliSetupError", () => {
  it("returns null for unrelated errors", () => {
    expect(normalizeClaudeCliSetupError("ValueError: invalid input")).toBeNull();
  });
});
