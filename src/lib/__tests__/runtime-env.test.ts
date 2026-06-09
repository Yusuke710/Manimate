import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildLocalClaudeEnv,
} from "@/lib/local/runtime";

describe("buildLocalClaudeEnv", () => {
  it("removes provider env keys and CODEX-prefixed vars", () => {
    const env = buildLocalClaudeEnv({
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/home",
      ANTHROPIC_API_KEY: "anthropic",
      ANTHROPIC_BASE_URL: "https://example.test",
      PORTKEY_API_KEY: "portkey",
      PORTKEY_BASE_URL: "https://portkey.test",
      OPENAI_API_KEY: "openai",
      CODEX_CI: "1",
      CODEX_MANAGED_BY_NPM: "1",
      CODEX_THREAD_ID: "thread-1",
      CI: "1",
      NODE_ENV: "test",
    });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.PORTKEY_API_KEY).toBeUndefined();
    expect(env.PORTKEY_BASE_URL).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_CI).toBeUndefined();
    expect(env.CODEX_MANAGED_BY_NPM).toBeUndefined();
    expect(env.CODEX_THREAD_ID).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/tmp/home");
    expect(env.CI).toBe("1");
    expect(env.NODE_ENV).toBe("test");
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("64000");
  });

  it("does not override a caller-provided CLAUDE_CODE_MAX_OUTPUT_TOKENS", () => {
    const env = buildLocalClaudeEnv({
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
      NODE_ENV: "test",
    });
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("32000");
  });
});

describe("local agent CLI args", () => {
  it("builds Claude print args without pinning a model", () => {
    const args = buildClaudeArgs({ prompt: "make animation" });

    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("-p");
    expect(args.at(-1)).toBe("make animation");
    expect(args).not.toContain("--model");
  });

  it("builds Claude resume args with the stored agent session id", () => {
    const args = buildClaudeArgs({
      prompt: "continue",
      resumeSessionId: "claude-session-1",
    });

    expect(args).toContain("--resume");
    expect(args).toContain("claude-session-1");
    expect(args.at(-1)).toBe("continue");
  });

  it("builds Codex exec args without pinning a model", () => {
    const args = buildCodexArgs({
      cwd: "/tmp/manimate-session",
      prompt: "make animation",
    });

    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--cd",
      "/tmp/manimate-session",
      "make animation",
    ]);
    expect(args).not.toContain("--model");
  });

  it("builds Codex resume args with the stored agent session id", () => {
    const args = buildCodexArgs({
      cwd: "/tmp/manimate-session",
      prompt: "continue",
      resumeSessionId: "019ea9e7-08e9-7202-aaac-e576623aa90b",
    });

    expect(args).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "019ea9e7-08e9-7202-aaac-e576623aa90b",
      "continue",
    ]);
  });
});
