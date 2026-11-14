import {afterEach, describe, expect, it, vi} from "vitest";
import {spawn} from "node:child_process";
import {prewarmLocalKokoroVoice} from "@/lib/local/runtime";
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(() => ({unref: vi.fn(), once: vi.fn()})),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("speech transport", () => {
  it("does not launch local inference for cloud rendering", () => {
    vi.stubEnv("MANIMATE_RENDER_MODE", "cloud"); vi.stubEnv("TTS_TRANSPORT", "");
    prewarmLocalKokoroVoice({cwd:"/tmp/speech-test",voiceId:"af_heart"});
    expect(spawn).not.toHaveBeenCalled();
  });
  it("honors an explicit local override", () => {
    vi.stubEnv("MANIMATE_RENDER_MODE", "cloud"); vi.stubEnv("TTS_TRANSPORT", "local");
    prewarmLocalKokoroVoice({cwd:"/tmp/speech-test",voiceId:"af_heart"});
    expect(spawn).toHaveBeenCalledOnce();
  });
  it("does not prewarm Kokoro for an ElevenLabs voice", () => {
    vi.stubEnv("TTS_TRANSPORT", "local");
    prewarmLocalKokoroVoice({cwd:"/tmp/speech-test",voiceId:"TX3LPaxmHKxFdv7VOQHJ"});
    expect(spawn).not.toHaveBeenCalled();
  });
});
