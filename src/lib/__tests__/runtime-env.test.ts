import { describe, expect, it } from "vitest";
import { buildLocalClaudeEnv } from "@/lib/local/runtime";

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
  });
});
