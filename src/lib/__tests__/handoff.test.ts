import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "@/lib/models";
import { NONE_VOICE_ID } from "@/lib/voices";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;

async function loadHandoffModules() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-handoff-"));
  process.env.MANIMATE_LOCAL_ROOT = root;
  vi.resetModules();
  const db = await import("@/lib/local/session-store");
  const handoff = await import("@/lib/local/handoff");
  return { db, handoff };
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }
  vi.resetModules();
});

describe("local session handoff", () => {
  it("inherits only the source aspect ratio by default", async () => {
    const { db, handoff } = await loadHandoffModules();
    const source = db.createLocalSession({
      model: "codex",
      aspect_ratio: "9:16",
      voice_id: "Lci8YeL6PAFHJjNKvwXq",
    });

    const result = await handoff.createHandoffFromLocalSession(source);

    expect(result.session.aspect_ratio).toBe("9:16");
    expect(result.session.model).toBe(DEFAULT_MODEL);
    expect(result.session.voice_id).toBeNull();
  });

  it("uses explicit model and sound choices for the new handoff session", async () => {
    const { db, handoff } = await loadHandoffModules();
    const source = db.createLocalSession({
      model: "claude",
      aspect_ratio: "1:1",
      voice_id: "TX3LPaxmHKxFdv7VOQHJ",
    });

    const result = await handoff.createHandoffFromLocalSession(source, {
      model: "codex",
      voiceId: NONE_VOICE_ID,
    });

    expect(result.session.aspect_ratio).toBe("1:1");
    expect(result.session.model).toBe("codex");
    expect(result.session.voice_id).toBe(NONE_VOICE_ID);
  });
});
